const fs = require('fs');
const path = require('path');

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';
const CONTRACT_PATH = path.join(process.cwd(), 'shared', 'contracts', 'user-contract.json');

function loadContract() {
  if (!fs.existsSync(CONTRACT_PATH)) {
    throw new Error(`No se encontró el contrato en: ${CONTRACT_PATH}`);
  }

  const rawContract = fs.readFileSync(CONTRACT_PATH, 'utf8');
  return JSON.parse(rawContract);
}

function getExpectedStatuses(endpoint) {
  if (Array.isArray(endpoint.expectedStatuses)) {
    return endpoint.expectedStatuses;
  }

  if (endpoint.expectedStatus) {
    return [endpoint.expectedStatus];
  }

  return [200];
}

function buildRequestBody(endpoint) {
  if (!endpoint.requestBody) {
    return null;
  }

  const body = { ...endpoint.requestBody };

  // Evita conflicto por correos repetidos si la prueba se ejecuta varias veces.
  if (endpoint.method.toUpperCase() === 'POST' && endpoint.path === '/users') {
    const uniqueValue = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    body.email = `contrato.${uniqueValue}@test.com`;
  }

  return body;
}

async function validateEndpoint(endpoint) {
  const method = endpoint.method.toUpperCase();
  const url = `${API_GATEWAY_URL}${endpoint.path}`;
  const expectedStatuses = getExpectedStatuses(endpoint);
  const body = buildRequestBody(endpoint);

  console.log('');
  console.log(`Validando endpoint: ${method} ${endpoint.path}`);
  console.log(`Nombre: ${endpoint.name || 'Sin nombre'}`);
  console.log(`URL: ${url}`);

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
    console.log(`Body enviado: ${JSON.stringify(body)}`);
  }

  const response = await fetch(url, options);

  let responseBody = null;
  const responseText = await response.text();

  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }

  console.log(`Status recibido: ${response.status}`);
  console.log(`Status esperado: ${expectedStatuses.join(' o ')}`);
  console.log(`Respuesta: ${JSON.stringify(responseBody)}`);

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `Status incorrecto en ${method} ${endpoint.path}. Esperado: ${expectedStatuses.join(' o ')}, recibido: ${response.status}`
    );
  }

  console.log(`Contrato válido para ${method} ${endpoint.path}`);
}

async function main() {
  try {
    const contract = loadContract();

    console.log(`Validando contrato del servicio: ${contract.service}`);
    console.log(`Versión del contrato: ${contract.version}`);
    console.log(`Proveedor: ${contract.provider}`);
    console.log(`Consumidor: ${contract.consumer}`);
    console.log(`API Gateway URL: ${API_GATEWAY_URL}`);

    if (!Array.isArray(contract.endpoints) || contract.endpoints.length === 0) {
      throw new Error('El contrato no tiene endpoints definidos.');
    }

    for (const endpoint of contract.endpoints) {
      await validateEndpoint(endpoint);
    }

    console.log('');
    console.log('Todos los contratos fueron validados correctamente.');
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('Error validando contrato:');
    console.error(error.message);
    process.exit(1);
  }
}

main();