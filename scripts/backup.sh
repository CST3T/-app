#!/usr/bin/env bash
# 备份 PostgreSQL：输出 backups/minutes-<时间戳>.sql.gz，并清理 14 天前的备份。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a && source "$ROOT/.env" && set +a
fi

DB_USER="${POSTGRES_USER:-minutes}"
DB_NAME="${POSTGRES_DB:-minutes}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/backups"
OUT="$OUT_DIR/minutes-$STAMP.sql.gz"

mkdir -p "$OUT_DIR"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip > "$OUT"

echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"

find "$OUT_DIR" -name 'minutes-*.sql.gz' -mtime +14 -delete
echo "cleanup: removed backups older than 14 days"
