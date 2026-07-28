const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const amqp = require('amqplib');

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'userdb',
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Redis
let redisClient = null;

// RabbitMQ
let rabbitChannel = null;

const connectRedis = async () => {
  try {
    if (redisClient && redisClient.isReady) {
      return redisClient;
    }

    redisClient = redis.createClient({
      url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`,
    });

    redisClient.on('error', (error) => {
      console.error('Redis Client Error:', error.message);
    });

    await redisClient.connect();
    console.log('Connected to Redis');

    return redisClient;
  } catch (error) {
    console.error('Redis connection failed:', error.message);
    return null;
  }
};

const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq');
    rabbitChannel = await connection.createChannel();
    await rabbitChannel.assertQueue('user_events', { durable: true });

    console.log('Connected to RabbitMQ');
    return rabbitChannel;
  } catch (error) {
    console.error('RabbitMQ connection failed:', error.message);
    return null;
  }
};

const createUsersTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

// Crear usuario
app.post('/users', async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Name and email are required',
    });
  }

  try {
    await createUsersTable();

    const result = await pool.query(
      'INSERT INTO users (name, email, created_at) VALUES ($1, $2, NOW()) RETURNING *',
      [name, email]
    );

    const user = result.rows[0];

    if (rabbitChannel) {
      rabbitChannel.sendToQueue(
        'user_events',
        Buffer.from(JSON.stringify({
          event: 'user_created',
          data: user,
          timestamp: new Date().toISOString(),
        }))
      );
    }

    return res.status(201).json(user);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'User already exists',
      });
    }

    return res.status(500).json({
      error: error.message,
    });
  }
});

// Obtener usuario por ID
app.get('/users/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    if (redisClient && redisClient.isReady) {
      const cachedUser = await redisClient.get(`user:${userId}`);

      if (cachedUser) {
        return res.json({
          source: 'cache',
          data: JSON.parse(cachedUser),
        });
      }
    }
  } catch (error) {
    console.error('Cache error:', error.message);
  }

  try {
    await createUsersTable();

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    const user = result.rows[0];

    try {
      if (redisClient && redisClient.isReady) {
        await redisClient.set(`user:${userId}`, JSON.stringify(user), {
          EX: 300,
        });
      }
    } catch (error) {
      console.error('Cache save error:', error.message);
    }

    return res.json({
      source: 'database',
      data: user,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Listar usuarios
app.get('/users', async (req, res) => {
  try {
    await createUsersTable();

    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users ORDER BY id ASC'
    );

    return res.json({
      total: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Health check con dependencias
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'user-service',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      redis: 'unknown',
      rabbitmq: 'unknown',
    },
  };

  try {
    await pool.query('SELECT 1');
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'disconnected';
    health.status = 'degraded';
  }

  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.ping();
      health.services.redis = 'connected';
    } else {
      health.services.redis = 'disconnected';
      health.status = 'degraded';
    }
  } catch (error) {
    health.services.redis = 'disconnected';
    health.status = 'degraded';
  }

  health.services.rabbitmq = rabbitChannel ? 'connected' : 'disconnected';

  if (!rabbitChannel) {
    health.status = 'degraded';
  }

  return res.json(health);
});

// Métricas en formato Prometheus
app.get('/metrics', (req, res) => {
  const memory = process.memoryUsage();

  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP user_service_uptime_seconds Tiempo activo del User Service en segundos
# TYPE user_service_uptime_seconds gauge
user_service_uptime_seconds ${process.uptime()}

# HELP user_service_memory_heap_used_bytes Memoria heap usada por User Service
# TYPE user_service_memory_heap_used_bytes gauge
user_service_memory_heap_used_bytes ${memory.heapUsed}

# HELP user_service_memory_rss_bytes Memoria RSS usada por User Service
# TYPE user_service_memory_rss_bytes gauge
user_service_memory_rss_bytes ${memory.rss}

# HELP user_service_redis_connected Estado de conexión con Redis
# TYPE user_service_redis_connected gauge
user_service_redis_connected ${redisClient && redisClient.isReady ? 1 : 0}

# HELP user_service_rabbitmq_connected Estado de conexión con RabbitMQ
# TYPE user_service_rabbitmq_connected gauge
user_service_rabbitmq_connected ${rabbitChannel ? 1 : 0}
`);
});

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`User Service running on port ${port}`);

    try {
      await createUsersTable();
    } catch (error) {
      console.error('Error creating users table:', error.message);
    }

    await connectRedis();
    await connectRabbitMQ();
  });
}

module.exports = {
  app,
  pool,
  connectRedis,
  connectRabbitMQ,
  createUsersTable,
  getRedisClient: () => redisClient,
  getRabbitChannel: () => rabbitChannel,
};