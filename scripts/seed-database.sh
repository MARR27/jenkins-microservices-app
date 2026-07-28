#!/bin/sh

echo "Insertando datos iniciales desde API Gateway..."

curl -s -X POST http://api-gateway:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Usuario Demo","email":"usuario.demo@test.com"}'

echo ""

curl -s -X POST http://api-gateway:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Producto Demo","price":199.99,"stock":10}'

echo ""
echo "Datos iniciales insertados correctamente"