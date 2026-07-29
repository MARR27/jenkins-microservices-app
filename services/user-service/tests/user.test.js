const request = require('supertest');
const { app, closeConnections } = require('../src/app');

jest.setTimeout(15000);

afterAll(async () => {
  await closeConnections();
});

describe('User Service', () => {
  test('GET /health debe responder información del servicio', async () => {
    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('service', 'user-service');
  });

  test('POST /users debe validar campos obligatorios', async () => {
    const response = await request(app)
      .post('/users')
      .send({ name: 'Usuario sin email' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});