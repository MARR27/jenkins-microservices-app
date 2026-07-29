const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const amqp = require('amqplib');

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isTestEnv = () => process.env.NODE_ENV === 'test';

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'userdb',
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

let redisClient = null;
let rabbitConnection = null;
let rabbitChannel = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms, label) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
};

const connectRedis = async () => {
  if (isTestEnv()) {
    return null;
  }

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
  if (isTestEnv()) {
    return null;
  }

  try {
    if (rabbitChannel) {
      return rabbitChannel;
    }

    rabbitConnection = await amqp.connect(
      process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672'
    );

    rabbitChannel = await rabbitConnection.createChannel();
    await rabbitChannel.assertQueue('user_events', { durable: true });

    console.log('Connected to RabbitMQ');
    return rabbitChannel;
  } catch (error) {
    console.error('RabbitMQ connection failed:', error.message);
    rabbitChannel = null;
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

const ensureDatabaseReady = async (attempts = 10) => {
  let lastError = null;

  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      await createUsersTable();
      await pool.query('SELECT COUNT(*) FROM users');
      return true;
    } catch (error) {
      lastError = error;
      console.log(`User Service DB intento ${i}/${attempts} falló: ${error.message}`);
      await sleep(2000);
    }
  }

  throw lastError;
};

app.post('/users', async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Name and email are required',
    });
  }

  try {
    await ensureDatabaseReady(3);

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

    console.error('Error creating user:', error.message);

    return res.status(500).json({
      error: 'Database error creating user',
      detail: error.message,
    });
  }
});

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
    console.error('Cache read error:', error.message);
  }

  try {
    await ensureDatabaseReady(3);

    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [userId]
    );

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
    console.error('Error getting user:', error.message);

    return res.status(500).json({
      error: 'Database error getting user',
      detail: error.message,
    });
  }
});

app.get('/users', async (req, res) => {
  try {
    await ensureDatabaseReady(3);

    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users ORDER BY id ASC'
    );

    return res.json({
      total: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error listing users:', error.message);

    return res.status(500).json({
      error: 'Database error listing users',
      detail: error.message,
    });
  }
});

app.get('/health', async (req, res) => {
  if (isTestEnv()) {
    return res.status(200).json({
      status: 'healthy',
      service: 'user-service',
      mode: 'unit-test',
      timestamp: new Date().toISOString(),
      services: {
        database: 'skipped',
        redis: 'skipped',
        rabbitmq: 'skipped',
      },
    });
  }

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
    await withTimeout(ensureDatabaseReady(3), 8000, 'database');
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'disconnected';
    health.status = 'unhealthy';
    health.databaseError = error.message;
  }

  try {
    if (!redisClient || !redisClient.isReady) {
      await withTimeout(connectRedis(), 5000, 'redis');
    }

    if (redisClient && redisClient.isReady) {
      await withTimeout(redisClient.ping(), 3000, 'redis ping');
      health.services.redis = 'connected';
    } else {
      health.services.redis = 'disconnected';
      health.status = 'unhealthy';
    }
  } catch (error) {
    health.services.redis = 'disconnected';
    health.status = 'unhealthy';
    health.redisError = error.message;
  }

  try {
    if (!rabbitChannel) {
      await withTimeout(connectRabbitMQ(), 8000, 'rabbitmq');
    }

    if (rabbitChannel) {
      health.services.rabbitmq = 'connected';
    } else {
      health.services.rabbitmq = 'disconnected';
      health.status = 'unhealthy';
    }
  } catch (error) {
    health.services.rabbitmq = 'disconnected';
    health.status = 'unhealthy';
    health.rabbitmqError = error.message;
  }

  return res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

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

const startConnections = async () => {
  try {
    await ensureDatabaseReady(10);
    console.log('User Service database ready');
  } catch (error) {
    console.error('User Service database not ready:', error.message);
  }

  await connectRedis();
  await connectRabbitMQ();
};

const closeConnections = async () => {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    console.error('Error closing Redis:', error.message);
  }

  try {
    if (rabbitConnection) {
      await rabbitConnection.close();
    }
  } catch (error) {
    console.error('Error closing RabbitMQ:', error.message);
  }

  try {
    await pool.end();
  } catch (error) {
    console.error('Error closing PostgreSQL pool:', error.message);
  }
};

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`User Service running on port ${port}`);
    await startConnections();
  });
}

module.exports = {
  app,
  pool,
  connectRedis,
  connectRabbitMQ,
  createUsersTable,
  ensureDatabaseReady,
  startConnections,
  closeConnections,
  getRedisClient: () => redisClient,
  getRabbitChannel: () => rabbitChannel,
};