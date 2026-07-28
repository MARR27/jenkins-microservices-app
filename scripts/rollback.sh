#!/bin/sh

set -e

PROJECT_NAME=${1:-micro-main}
COMPOSE_FILE=${2:-docker/docker-compose.base.yml}

echo "Iniciando rollback automático..."
echo "Proyecto Docker Compose: $PROJECT_NAME"
echo "Archivo Compose: $COMPOSE_FILE"

echo "Mostrando contenedores antes del rollback..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --profile app --profile monitoring ps || true

echo "Recolectando logs antes de limpiar..."
mkdir -p rollback-logs

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --profile app --profile monitoring logs --tail=100 > "rollback-logs/${PROJECT_NAME}-rollback.log" || true

echo "Deteniendo ambiente fallido..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --profile app --profile monitoring down --remove-orphans || true

echo "Validando limpieza del ambiente..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --profile app --profile monitoring ps || true

echo "Rollback automático finalizado correctamente."