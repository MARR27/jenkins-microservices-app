const request = require('supertest');
const { app } = require('../src/app');

describe('Product Service', () => {
  test('GET /health debe responder información del servicio', async () => {
    const response = await request(app).get('/health');

    expect([200]).toContain(response.statusCode);
    expect(response.body.service).toBe('product-service');
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('services');
  });

  test('POST /products debe validar campos obligatorios', async () => {
    const response = await request(app).post('/products').send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('Name and price are required');
  });
});