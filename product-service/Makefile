.PHONY: help env up down logs build rebuild restart shell psql migrate studio nuke clean

# Compose file lives next to this Makefile.
COMPOSE := docker compose
SERVICE := product-service

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

env: ## Copy .env.example -> .env if missing
	@test -f .env || cp .env.example .env
	@echo "env: .env present"

up: env ## Build and start the stack in the background
	$(COMPOSE) up -d --build

down: ## Stop the stack (keep volumes)
	$(COMPOSE) down

logs: ## Tail logs for product-service
	$(COMPOSE) logs -f $(SERVICE)

build: env ## Build images without starting
	$(COMPOSE) build

rebuild: env ## Force a clean rebuild
	$(COMPOSE) build --no-cache

restart: env ## Restart product-service
	$(COMPOSE) restart $(SERVICE)

shell: env ## Open a shell in the running product-service container
	$(COMPOSE) exec $(SERVICE) sh

psql: env ## Open psql against product-db
	$(COMPOSE) exec product-db psql -U $${POSTGRES_USER:-product_user} -d $${POSTGRES_DB:-product_db}

migrate: env ## Apply Prisma migrations (uses dev container)
	$(COMPOSE) run --rm $(SERVICE) npx prisma migrate deploy

studio: env ## Open Prisma Studio (http://localhost:5555)
	$(COMPOSE) run --rm -p 5555:5555 $(SERVICE) npx prisma studio

nuke: ## Stop stack and DELETE the named volume (DESTRUCTIVE)
	$(COMPOSE) down -v

clean: nuke ## Same as nuke
