#!/bin/sh
# Declares the shared topic exchange and binds the inventory queue.
# Idempotent: declare is a no-op when the entity already exists.
set -eu

RABBIT_HOST="${RABBIT_HOST:-rabbitmq}"
RABBIT_PORT="${RABBIT_PORT:-15672}"
RABBIT_USER="${RABBIT_USER:-guest}"
RABBIT_PASS="${RABBIT_PASS:-guest}"

EXCHANGE="ecommerce.events"
QUEUE="inventory-service.products.created"
ROUTING_KEY="products.event.*"

echo "Declaring exchange '${EXCHANGE}'..."
rabbitmqadmin -H "$RABBIT_HOST" -P "$RABBIT_PORT" \
  -u "$RABBIT_USER" -p "$RABBIT_PASS" \
  declare exchange name="${EXCHANGE}" type=topic durable=true

echo "Declaring queue '${QUEUE}'..."
rabbitmqadmin -H "$RABBIT_HOST" -P "$RABBIT_PORT" \
  -u "$RABBIT_USER" -p "$RABBIT_PASS" \
  declare queue name="${QUEUE}" durable=true

echo "Binding queue to exchange with routing key '${ROUTING_KEY}'..."
rabbitmqadmin -H "$RABBIT_HOST" -P "$RABBIT_PORT" \
  -u "$RABBIT_USER" -p "$RABBIT_PASS" \
  declare binding source="${EXCHANGE}" destination_type=queue \
  destination="${QUEUE}" routing_key="${ROUTING_KEY}"

echo "RabbitMQ topology ready."
