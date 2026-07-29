const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const ensureDatabaseReady = async (attempts = 10) => {
  let lastError = null;

  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      await createProductsTable();
      await pool.query('SELECT COUNT(*) FROM products');
      return true;
    } catch (error) {
      lastError = error;
      console.log(`Product Service DB intento ${i}/${attempts} falló: ${error.message}`);
      await sleep(2000);
    }
  }

  throw lastError;
};

app.post('/products', async (req, res) => {
  const { name, price, stock } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({
      error: 'Name and price are required',
    });
  }

  try {
    await ensureDatabaseReady(3);

    const result = await pool.query(
      'INSERT INTO products (name, price, stock, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [name, price, stock || 0]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating product:', error.message);

    return res.status(500).json({
      error: 'Database error creating product',
      detail: error.message,
    });
  }
});

app.get('/products', async (req, res) => {
  try {
    await ensureDatabaseReady(3);

    const result = await pool.query(
      'SELECT id, name, price, stock, created_at FROM products ORDER BY id ASC'
    );

    return res.json({
      total: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error listing products:', error.message);

    return res.status(500).json({
      error: 'Database error listing products',
      detail: error.message,
    });
  }
});

app.get('/products/:id', async (req, res) => {
  const productId = req.params.id;

  try {
    await ensureDatabaseReady(3);

    const result = await pool.query(
      'SELECT id, name, price, stock, created_at FROM products WHERE id = $1',
      [productId]
    );

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
    console.error('Error getting product:', error.message);

    return res.status(500).json({
      error: 'Database error getting product',
      detail: error.message,
    });
  }
});

app.get('/health', async (req, res) => {
  if (isTestEnv()) {
    return res.status(200).json({
      status: 'healthy',
      service: 'product-service',
      mode: 'unit-test',
      timestamp: new Date().toISOString(),
      services: {
        database: 'skipped',
        productsTable: 'skipped',
      },
    });
  }

  const health = {
    status: 'healthy',
    service: 'product-service',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      productsTable: 'unknown',
    },
  };

  try {
    await ensureDatabaseReady(3);
    health.services.database = 'connected';
    health.services.productsTable = 'ready';

    return res.status(200).json(health);
  } catch (error) {
    health.status = 'unhealthy';
    health.services.database = 'disconnected';
    health.services.productsTable = 'not_ready';
    health.error = error.message;

    return res.status(503).json(health);
  }
});

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

const startConnections = async () => {
  try {
    await ensureDatabaseReady(10);
    console.log('Product Service database ready');
  } catch (error) {
    console.error('Product Service database not ready:', error.message);
  }
};

const closeConnections = async () => {
  try {
    await pool.end();
  } catch (error) {
    console.error('Error closing PostgreSQL pool:', error.message);
  }
};

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`Product Service running on port ${port}`);
    await startConnections();
  });
}

module.exports = {
  app,
  pool,
  createProductsTable,
  ensureDatabaseReady,
  startConnections,
  closeConnections,
};