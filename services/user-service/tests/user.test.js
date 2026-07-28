const request = require('supertest');
const { app } = require('../src/app');

describe('User Service', () => {
  test('GET /health debe responder información del servicio', async () => {
    const response = await request(app).get('/health');

    expect([200]).toContain(response.statusCode);
    expect(response.body.service).toBe('user-service');
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('services');
  });

  test('POST /users debe validar campos obligatorios', async () => {
    const response = await request(app).post('/users').send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('Name and email are required');
  });
});