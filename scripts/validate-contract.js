const fs = require('fs');
const path = require('path');

const contractPath = path.join(__dirname, '..', 'shared', 'contracts', 'user-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';

const validateType = (value, expectedType) => {
  if (expectedType === 'array') {
    return Array.isArray(value);
  }

  if (expectedType === 'number') {
    return typeof value === 'number';
  }

  if (expectedType === 'string') {
    return typeof value === 'string';
  }

  if (expectedType === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  return false;
};

const validateFields = (object, expectedFields, context) => {
  for (const [field, expectedType] of Object.entries(expectedFields)) {
    if (!(field in object)) {
      throw new Error(`Falta el campo "${field}" en ${context}`);
    }

    if (!validateType(object[field], expectedType)) {
      throw new Error(
        `El campo "${field}" en ${context} debe ser ${expectedType}, pero recibió ${typeof object[field]}`
      );
    }
  }
};

const runContractValidation = async () => {
  console.log(`Validando contrato del servicio: ${contract.service}`);
  console.log(`Versión del contrato: ${contract.version}`);
  console.log(`API Gateway URL: ${API_GATEWAY_URL}`);

  for (const endpoint of contract.endpoints) {
    console.log(`\nValidando endpoint: ${endpoint.method} ${endpoint.path}`);

    const options = {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (endpoint.body) {
      options.body = JSON.stringify(endpoint.body);
    }

    const response = await fetch(`${API_GATEWAY_URL}${endpoint.path}`, options);

    console.log(`Status recibido: ${response.status}`);

    if (response.status !== endpoint.expectedStatus) {
      throw new Error(
        `Status incorrecto en ${endpoint.method} ${endpoint.path}. Esperado: ${endpoint.expectedStatus}, recibido: ${response.status}`
      );
    }

    const data = await response.json();

    validateFields(data, endpoint.expectedFields, `${endpoint.method} ${endpoint.path}`);

    if (endpoint.dataItemFields && Array.isArray(data.data) && data.data.length > 0) {
      validateFields(data.data[0], endpoint.dataItemFields, `primer elemento de ${endpoint.path}`);
    }

    console.log(`Contrato válido para ${endpoint.method} ${endpoint.path}`);
  }

  console.log('\nTodos los contratos fueron validados correctamente.');
};

runContractValidation().catch((error) => {
  console.error('\nError validando contrato:');
  console.error(error.message);
  process.exit(1);
});