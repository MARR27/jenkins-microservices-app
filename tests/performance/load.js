import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';

export default function () {
  const healthResponse = http.get(`${BASE_URL}/health`);

  check(healthResponse, {
    'health responde 200': (response) => response.status === 200,
  });

  const usersResponse = http.get(`${BASE_URL}/users`);

  check(usersResponse, {
    'users responde 200': (response) => response.status === 200,
  });

  const productsResponse = http.get(`${BASE_URL}/products`);

  check(productsResponse, {
    'products responde 200': (response) => response.status === 200,
  });

  sleep(1);
}