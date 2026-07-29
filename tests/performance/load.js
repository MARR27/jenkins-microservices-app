import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 3,
  duration: '15s',
  thresholds: {
    http_req_failed: ['rate<0.20'],
    http_req_duration: ['p(95)<8000'],
    checks: ['rate>0.80'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';

function requestWithRetry(path, label, retries = 3) {
  let response = null;

  for (let i = 1; i <= retries; i++) {
    response = http.get(`${BASE_URL}${path}`);

    if (response.status === 200) {
      break;
    }

    console.log(`${label} intento ${i}/${retries} falló con status ${response.status}`);
    console.log(response.body);
    sleep(2);
  }

  check(response, {
    [`${label} responde 200`]: (res) => res && res.status === 200,
  });

  return response;
}

function waitForEndpoint(path, label, retries = 15) {
  for (let i = 1; i <= retries; i++) {
    const response = http.get(`${BASE_URL}${path}`);

    if (response.status === 200) {
      console.log(`${label} listo con status 200`);
      return true;
    }

    console.log(`${label} no listo intento ${i}/${retries}: ${response.status}`);
    console.log(response.body);
    sleep(2);
  }

  return false;
}

export function setup() {
  console.log(`Ejecutando prueba de carga contra: ${BASE_URL}`);

  waitForEndpoint('/health', 'health');
  waitForEndpoint('/users', 'users');
  waitForEndpoint('/products', 'products');

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

  sleep(5);
}

export default function () {
  requestWithRetry('/health', 'health');
  requestWithRetry('/users', 'users');
  requestWithRetry('/products', 'products');

  sleep(1);
}