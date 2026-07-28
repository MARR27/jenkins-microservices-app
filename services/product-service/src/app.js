const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());

// PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'productdb',
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const createProductsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      price NUMERIC(10, 2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

// Crear producto
app.post('/products', async (req, res) => {
  const { name, price, stock } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({
      error: 'Name and price are required',
    });
  }

  try {
    await createProductsTable();

    const result = await pool.query(
      'INSERT INTO products (name, price, stock, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [name, price, stock || 0]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Listar productos
app.get('/products', async (req, res) => {
  try {
    await createProductsTable();

    const result = await pool.query(
      'SELECT id, name, price, stock, created_at FROM products ORDER BY id ASC'
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

// Obtener producto por ID
app.get('/products/:id', async (req, res) => {
  const productId = req.params.id;

  try {
    await createProductsTable();

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    return res.json({
      source: 'database',
      data: result.rows[0],
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'product-service',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
    },
  };

  try {
    await pool.query('SELECT 1');
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'disconnected';
    health.status = 'degraded';
  }

  return res.json(health);
});

// Métricas en formato Prometheus
app.get('/metrics', (req, res) => {
  const memory = process.memoryUsage();

  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP product_service_uptime_seconds Tiempo activo del Product Service en segundos
# TYPE product_service_uptime_seconds gauge
product_service_uptime_seconds ${process.uptime()}

# HELP product_service_memory_heap_used_bytes Memoria heap usada por Product Service
# TYPE product_service_memory_heap_used_bytes gauge
product_service_memory_heap_used_bytes ${memory.heapUsed}

# HELP product_service_memory_rss_bytes Memoria RSS usada por Product Service
# TYPE product_service_memory_rss_bytes gauge
product_service_memory_rss_bytes ${memory.rss}
`);
});

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`Product Service running on port ${port}`);

    try {
      await createProductsTable();
    } catch (error) {
      console.error('Error creating products table:', error.message);
    }
  });
}

module.exports = {
  app,
  pool,
  createProductsTable,
};