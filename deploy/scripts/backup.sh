#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# backup.sh - Автоматическое резервное копирование SQLite базы KoW Tracker
# Добавление в crontab (каждую ночь в 03:00):
# 0 3 * * * /opt/kow-tracker/deploy/scripts/backup.sh > /dev/null 2>&1
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# Каталог проекта
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DATA_FILE="$PROJECT_DIR/data/kow.db"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DATA_FILE" ]]; then
  echo "⚠️ База данных не найдена: $DATA_FILE" >&2
  exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/kow_backup_${TIMESTAMP}.db"
ARCHIVE_FILE="${BACKUP_FILE}.tar.gz"

echo "📦 Создание резервной копии: $DATA_FILE -> $ARCHIVE_FILE"

# Если утилита sqlite3 доступна — делаем безопасный горячий snapshot через онлайн-бэкап
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA_FILE" ".backup '$BACKUP_FILE'"
  tar -czf "$ARCHIVE_FILE" -C "$BACKUP_DIR" "$(basename "$BACKUP_FILE")"
  rm -f "$BACKUP_FILE"
else
  # Иначе архивируем напрямую
  tar -czf "$ARCHIVE_FILE" -C "$(dirname "$DATA_FILE")" "$(basename "$DATA_FILE")"
fi

echo "✅ Бэкап успешно создан: $ARCHIVE_FILE ($(du -h "$ARCHIVE_FILE" | cut -f1))"

# Удаление бэкапов старше RETENTION_DAYS дней
echo "🧹 Ротация старых копий (старше $RETENTION_DAYS дней)..."
find "$BACKUP_DIR" -type f -name "kow_backup_*.tar.gz" -mtime +"$RETENTION_DAYS" -exec rm -f {} \;

echo "✨ Завершено."
