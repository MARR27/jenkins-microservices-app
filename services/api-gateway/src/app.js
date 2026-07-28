const express = require('express');
const axios = require('axios');
const CircuitBreaker = require('opossum');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// URLs internas de los microservicios
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';

// Función genérica para llamar microservicios
const callService = async (baseUrl, req) => {
  const response = await axios({
    method: req.method,
    url: `${baseUrl}${req.originalUrl}`,
    data: req.body,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 3000,
  });

  return response.data;
};

// Circuit breaker para User Service
const userServiceBreaker = new CircuitBreaker(
  async (req) => callService(USER_SERVICE_URL, req),
  {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
  }
);

// Circuit breaker para Product Service
const productServiceBreaker = new CircuitBreaker(
  async (req) => callService(PRODUCT_SERVICE_URL, req),
  {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
  }
);

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Health check del gateway
app.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    dependencies: {
      userServiceCircuit: userServiceBreaker.opened ? 'open' : 'closed',
      productServiceCircuit: productServiceBreaker.opened ? 'open' : 'closed',
    },
  });
});

// Métricas en formato Prometheus
app.get('/metrics', (req, res) => {
  const memory = process.memoryUsage();

  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP api_gateway_uptime_seconds Tiempo activo del API Gateway en segundos
# TYPE api_gateway_uptime_seconds gauge
api_gateway_uptime_seconds ${process.uptime()}

# HELP api_gateway_memory_heap_used_bytes Memoria heap usada por API Gateway
# TYPE api_gateway_memory_heap_used_bytes gauge
api_gateway_memory_heap_used_bytes ${memory.heapUsed}

# HELP api_gateway_memory_rss_bytes Memoria RSS usada por API Gateway
# TYPE api_gateway_memory_rss_bytes gauge
api_gateway_memory_rss_bytes ${memory.rss}

# HELP api_gateway_user_circuit_open Estado del circuit breaker de User Service
# TYPE api_gateway_user_circuit_open gauge
api_gateway_user_circuit_open ${userServiceBreaker.opened ? 1 : 0}

# HELP api_gateway_product_circuit_open Estado del circuit breaker de Product Service
# TYPE api_gateway_product_circuit_open gauge
api_gateway_product_circuit_open ${productServiceBreaker.opened ? 1 : 0}
`);
});

// Rutas hacia User Service
app.all('/users', async (req, res) => {
  try {
    const result = await userServiceBreaker.fire(req);
    res.json(result);
  } catch (error) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'User service is currently unavailable',
      detail: error.message,
    });
  }
});

app.all('/users/:id', async (req, res) => {
  try {
    const result = await userServiceBreaker.fire(req);
    res.json(result);
  } catch (error) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'User service is currently unavailable',
      detail: error.message,
    });
  }
});

// Rutas hacia Product Service
app.all('/products', async (req, res) => {
  try {
    const result = await productServiceBreaker.fire(req);
    res.json(result);
  } catch (error) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Product service is currently unavailable',
      detail: error.message,
    });
  }
});

app.all('/products/:id', async (req, res) => {
  try {
    const result = await productServiceBreaker.fire(req);
    res.json(result);
  } catch (error) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Product service is currently unavailable',
      detail: error.message,
    });
  }
});

// Ruta por defecto
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`API Gateway running on port ${port}`);
  });
}

module.exports = {
  app,
  userServiceBreaker,
  productServiceBreaker,
};