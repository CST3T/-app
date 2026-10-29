# 会记 Minutes · 平台命令（Windows 建议在 Git Bash / WSL 下执行）
# 说明：.env 由 infra/.env.example 复制而来，compose 自动读取仓库根目录 .env

COMPOSE := docker compose -f infra/docker-compose.yml --env-file .env
COMPOSE_FILE := infra/docker-compose.yml

.PHONY: help env up down restart logs ps migrate migrate-sql seed test-api test-web e2e backup restore

help:
	@echo "make env          复制 infra/.env.example 为 .env"
	@echo "make up           构建并启动 postgres/redis/minio/api/web"
	@echo "make down         停止容器（保留数据卷）"
	@echo "make logs         跟踪 api 日志"
	@echo "make migrate      在容器内执行 alembic upgrade head"
	@echo "make migrate-sql  离线生成迁移 SQL（不连库，用于审阅/CI）"
	@echo "make seed         写入演示种子数据"
	@echo "make test-api     后端 pytest"
	@echo "make test-web     前端 typecheck + build"
	@echo "make e2e          前端 E2E（需先启动 web 与 api）"
	@echo "make backup       pg_dump 到 backups/"
	@echo "make restore      FILE=backups/xxx.sql.gz 恢复"

env:
	@test -f .env || cp infra/.env.example .env
	@echo ".env ready"

up: env
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

logs:
	$(COMPOSE) logs -f api

ps:
	$(COMPOSE) ps

migrate: env
	$(COMPOSE) run --rm api alembic upgrade head

migrate-sql:
	cd apps/api && .venv/Scripts/python.exe -m alembic upgrade head --sql > ../../infra/schema.sql

seed: env
	$(COMPOSE) run --rm api python -m app.seed_db

test-api:
	cd apps/api && .venv/Scripts/python.exe -m pytest -q

test-web:
	cd apps/web && npm run typecheck && npm run build

e2e:
	cd apps/web && npx playwright test

backup:
	./scripts/backup.sh

restore:
	./scripts/restore.sh $(FILE)
