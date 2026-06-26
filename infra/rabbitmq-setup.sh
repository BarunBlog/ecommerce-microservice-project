#!/bin/sh
# infra/rabbitmq-setup.sh
#
# One-shot broker topology bootstrap. Runs after the RabbitMQ container
# is healthy and asserts the shared topic exchange that
# product-service publishes to.
#
# Why this exists:
#   Nest's `ClientsModule.register({ transport: Transport.RMQ, ... })`
#   on the *producer* side does NOT call `exchangeAssert` at connect
#   time — the exchange is declared lazily, only when something is
#   first published. That means a producer that has emitted nothing
#   yet leaves the broker with no exchange, and the first publish goes
#   to a black hole (the broker silently routes to a default queue
#   with the routing key as queue name, or drops the message entirely
#   depending on the publisher confirm flag).
#
#   We saw this in practice: the producer's "Published products.event.created"
#   log appeared, but `rabbitmqctl list_exchanges` showed no
#   `ecommerce.events` topic exchange. The 4 orphan messages in the
#   default queue matched the 4 products created — they went nowhere.
#
# This script declares the topic exchange and (idempotently) binds the
# inventory-service queue with the wildcard routing key the consumer
# expects. Safe to re-run: `declare` operations are no-ops when the
# entity already exists with the same properties.
#
# Future bindings (notification-service, search-service, ...) go here
# too — consumers declare their own bindings, but the producer's
# exchange is shared platform infrastructure and belongs in this file.

set -e

# rabbitmqadmin is shipped inside the official `rabbitmq:3-management`
# image at /usr/sbin/rabbitmqadmin. We exec into the running broker
# container so we don't have to maintain a separate image just for this
# script.

echo "[rabbitmq-setup] declaring topic exchange 'ecommerce.events'..."
docker exec rabbitmq rabbitmqadmin -V / declare exchange \
  name=ecommerce.events \
  type=topic \
  durable=true

# Inventory-service queue. The queue itself is declared by the
# consumer's Nest RMQ transport on its own connect (queueOptions:
# durable: true in inventory-service/src/main.ts). We only need to
# bind it to the topic exchange here. The consumer's transport
# SHOULD do this itself on connect, but in practice we've seen cases
# where it creates the queue under the default exchange only, leaving
# the queue bound to nothing useful. Binding it explicitly here is
# idempotent and removes that footgun.

echo "[rabbitmq-setup] binding inventory queue to ecommerce.events..."
docker exec rabbitmq rabbitmqadmin -V / declare binding \
  source=ecommerce.events \
  destination=inventory-service.products.created \
  routing_key='products.event.*'

echo "[rabbitmq-setup] done."