#!/bin/sh

echo "Verificando estado de servicios..."

check_service() {
  SERVICE_NAME=$1
  URL=$2

  echo "Revisando $SERVICE_NAME en $URL"

  for i in $(seq 1 30); do
    if curl -s -f "$URL" > /dev/null; then
      echo "$SERVICE_NAME está disponible"
      return 0
    fi

    echo "Intento $i: $SERVICE_NAME aún no responde..."
    sleep 2
  done

  echo "$SERVICE_NAME no respondió a tiempo"
  exit 1
}

check_service "API Gateway" "http://api-gateway:3000/health"
check_service "User Service" "http://user-service:3001/health"
check_service "Product Service" "http://product-service:3002/health"

echo "Todos los servicios principales están disponibles"