import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<3000'],
    checks: ['rate>0.90'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';

function getWithRetry(path, label) {
  let response = http.get(`${BASE_URL}${path}`);

  if (response.status !== 200) {
    sleep(1);
    response = http.get(`${BASE_URL}${path}`);
  }

  check(response, {
    [`${label} responde 200`]: (res) => res.status === 200,
  });

  if (response.status !== 200) {
    console.log(`${label} falló con status ${response.status}`);
    console.log(response.body);
  }

  return response;
}

export function setup() {
  console.log(`Ejecutando prueba de carga contra: ${BASE_URL}`);

  const healthResponse = http.get(`${BASE_URL}/health`);
  console.log(`Health status inicial: ${healthResponse.status}`);

  const usersResponse = http.get(`${BASE_URL}/users`);
  console.log(`Users status inicial: ${usersResponse.status}`);

  const productsResponse = http.get(`${BASE_URL}/products`);
  console.log(`Products status inicial: ${productsResponse.status}`);

  if (productsResponse.status !== 200) {
    console.log('Respuesta inicial de /products:');
    console.log(productsResponse.body);
  }

  // Datos mínimos para que los endpoints tengan información durante la prueba.
  http.post(
    `${BASE_URL}/users`,
    JSON.stringify({
      name: `K6 User ${Date.now()}`,
      email: `k6.user.${Date.now()}@test.com`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  http.post(
    `${BASE_URL}/products`,
    JSON.stringify({
      name: `K6 Product ${Date.now()}`,
      price: 99.99,
      stock: 5,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  sleep(3);
}

export default function () {
  getWithRetry('/health', 'health');
  getWithRetry('/users', 'users');
  getWithRetry('/products', 'products');

  sleep(1);
}