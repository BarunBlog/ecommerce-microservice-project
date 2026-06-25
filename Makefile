# Root Makefile — platform-wide orchestration
#
# Coordinates the two-tier architecture:
#   Tier 1: shared platform infrastructure (infra/docker-compose.yml)
#           — RabbitMQ today, more to come.
#   Tier 2: individual application microservices — each with its own
#           service-level docker-compose.yml that marks
#           `shared-platform-net` as external.
#
# Boot sequence:
#   1. make infra-up       # bring up the shared infrastructure
#   2. make <svc>-up       # bring up a service, e.g. make product-up
#
# Convenience targets:
#   make up               # infra-up + all known services
#   make down             # tear down services + infra (keeps volumes)
#   make status           # show what's running
#
# Service-level compose files referenced below must be invoked from
# their own directory (cd <service>) per AGENTS.md §2.

.PHONY: help infra-up infra-down infra-logs infra-status \
        category-up category-down category-logs category-status \
        product-up product-down product-logs product-status \
        up down status ps

# --- Tier 1: shared infrastructure ---------------------------------------
INFRA_DIR       := infra
INFRA_COMPOSE   := docker compose -f $(INFRA_DIR)/docker-compose.yml

infra-up: ## Start shared platform infrastructure (RabbitMQ) in the background
	$(INFRA_COMPOSE) up -d

infra-down: ## Stop shared platform infrastructure (keeps volumes)
	$(INFRA_COMPOSE) down

infra-logs: ## Tail logs for the shared infrastructure
	$(INFRA_COMPOSE) logs -f

infra-status: ## Show running containers + networks for the infra stack
	$(INFRA_COMPOSE) ps

# --- Tier 2: application microservices -----------------------------------
# Each service keeps its own compose file. We only forward the `up/down/
# logs/ps` verbs from the root; richer targets (migrate, shell, nuke,
# etc.) still live in each service's own Makefile — `cd <service> && make`.

CATEGORY_DIR    := category-service
PRODUCT_DIR     := product-service

category-up: infra-up ## Start category-service (depends on infra being up)
	cd $(CATEGORY_DIR) && docker compose up -d --build

category-down: ## Stop category-service
	cd $(CATEGORY_DIR) && docker compose down

category-logs: ## Tail logs for category-service
	cd $(CATEGORY_DIR) && docker compose logs -f

category-status: ## Show category-service containers
	cd $(CATEGORY_DIR) && docker compose ps

product-up: infra-up ## Start product-service (depends on infra being up)
	cd $(PRODUCT_DIR) && docker compose up -d --build

product-down: ## Stop product-service
	cd $(PRODUCT_DIR) && docker compose down

product-logs: ## Tail logs for product-service
	cd $(PRODUCT_DIR) && docker compose logs -f

product-status: ## Show product-service containers
	cd $(PRODUCT_DIR) && docker compose ps

# --- Cross-cutting helpers ------------------------------------------------

up: infra-up category-up product-up ## Start infra + all known services
	@echo ""
	@echo "Stack is up:"
	@echo "  - category-service: http://localhost:8000/api/healthz"
	@echo "  - product-service : http://localhost:8001/api/healthz"
	@echo "  - rabbitmq mgmt ui : http://localhost:15672  (guest/guest)"

down: ## Stop all services and shared infra (keeps volumes)
	cd $(PRODUCT_DIR)  && docker compose down
	cd $(CATEGORY_DIR) && docker compose down
	$(INFRA_COMPOSE) down

status: ## Show what's running across every tier
	@echo "=== infra ==="
	$(INFRA_COMPOSE) ps || true
	@echo ""
	@echo "=== category-service ==="
	(cd $(CATEGORY_DIR) && docker compose ps) || true
	@echo ""
	@echo "=== product-service ==="
	(cd $(PRODUCT_DIR) && docker compose ps) || true

ps: status ## Alias for `make status`

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'