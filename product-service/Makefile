.PHONY: help env up down logs build rebuild restart shell psql migrate migrate-new migrate-status studio nuke clean install

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

migrate: env ## Apply pending Prisma migrations (runs inside the container)
	$(COMPOSE) run --rm $(SERVICE) npx prisma migrate deploy

migrate-status: env ## Show Prisma migration status (runs inside the container)
	$(COMPOSE) run --rm $(SERVICE) npx prisma migrate status

migrate-new: env ## Author a NEW migration on the host. Usage: make migrate-new NAME=add_some_field
	@if [ -z "$(NAME)" ]; then \
		echo "Usage: make migrate-new NAME=your_migration_name"; \
		echo "  Example: make migrate-new NAME=add_inventory_count"; \
		exit 1; \
	fi
	@echo "==> Authoring migration '$(NAME)' against $$DATABASE_URL"
	@echo "    Host-side: needs a Postgres reachable from the host ($${POSTGRES_HOST:-localhost}:$${POSTGRES_PORT:-5432})"
	@echo "    Tip: if you only have the Docker Postgres up, set POSTGRES_HOST=localhost in .env first."
	@npm run --silent prisma:migrate:dev -- --name $(NAME)

studio: env ## Open Prisma Studio (http://localhost:5555)
	$(COMPOSE) run --rm -p 5555:5555 $(SERVICE) npx prisma studio

install: env ## Install npm deps (host-side, needed for `make migrate-new`)
	npm install
