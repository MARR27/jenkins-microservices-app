const request = require('supertest');
const { app } = require('../src/app');

describe('API Gateway', () => {
  test('GET /health debe responder estado healthy', async () => {
    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.service).toBe('api-gateway');
  });

  test('Ruta inexistente debe responder 404', async () => {
    const response = await request(app).get('/ruta-inexistente');

    expect(response.statusCode).toBe(404);
    expect(response.body.error).toBe('Route not found');
  });
});