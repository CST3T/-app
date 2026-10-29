#!/usr/bin/env bash
# 恢复 PostgreSQL：scripts/restore.sh backups/minutes-20261028-120000.sql.gz
# 会先要求确认，再清空目标库 schema 后重放 dump。
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 backups/minutes-<stamp>.sql.gz" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a && source "$ROOT/.env" && set +a
fi

DB_USER="${POSTGRES_USER:-minutes}"
DB_NAME="${POSTGRES_DB:-minutes}"

read -r -p "将清空 $DB_NAME 并重放 $(basename "$FILE")，输入 yes 继续: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "aborted"; exit 1; }

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

gunzip -c "$FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1

echo "restore done: $FILE"
echo "下一步：make migrate  确认迁移版本与结构一致"
