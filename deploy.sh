#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# KoW Tracker - Автоматизированный скрипт развертывания
# Использование:
#   chmod +x deploy.sh && ./deploy.sh
# Или без интерактивных запросов:
#   ./deploy.sh --auto
# ─────────────────────────────────────────────────────────────

set -euo pipefail

AUTO_MODE=false
if [[ "${1:-}" == "--auto" || "${1:-}" == "-y" ]]; then
  AUTO_MODE=true
fi

# Цвета для вывода в консоль
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
BOLD="\033[1m"
RESET="\033[0m"

log_info() {
  echo -e "${BLUE}ℹ️  ${1}${RESET}"
}

log_success() {
  echo -e "${GREEN}✅ ${1}${RESET}"
}

log_warn() {
  echo -e "${YELLOW}⚠️  ${1}${RESET}"
}

log_error() {
  echo -e "${RED}❌ ${1}${RESET}" >&2
}

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${BOLD}"
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║           Kingdom of Winners (KoW) Tracker Deployment              ║"
echo "║          Автоматический мастер развертывания на сервере            ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# 1. Проверка операционной системы
OS_TYPE="$(uname -s)"
log_info "Определение операционной системы: $OS_TYPE ($(uname -m))"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

# 2. Проверка и установка Docker / Docker Compose
check_and_install_docker() {
  if has_command docker; then
    log_success "Docker уже установлен: $(docker --version)"
  else
    log_warn "Docker не найден на сервере."

    if [[ "$OS_TYPE" != "Linux" ]]; then
      log_error "Автоматическая установка Docker поддерживается только на Linux. Установите Docker Desktop вручную для $OS_TYPE."
      exit 1
    fi

    if [[ "$AUTO_MODE" != true ]]; then
      read -rp "Установить Docker автоматически с официального сайта docker.com? [Y/n]: " user_choice
      if [[ "$user_choice" =~ ^[Nn] ]]; then
        log_error "Развертывание отменено пользователем (требуется Docker)."
        exit 1
      fi
    fi

    log_info "Запуск официального инсталлятора Docker (https://get.docker.com)..."
    if has_command curl; then
      curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    elif has_command wget; then
      wget -qO /tmp/get-docker.sh https://get.docker.com
    else
      log_error "Для загрузки инсталлятора требуется curl или wget."
      exit 1
    fi

    if [[ "$EUID" -ne 0 ]]; then
      if has_command sudo; then
        sudo sh /tmp/get-docker.sh
        sudo systemctl enable --now docker || true
      else
        log_error "Требуются права root или sudo для установки Docker."
        exit 1
      fi
    else
      sh /tmp/get-docker.sh
      systemctl enable --now docker || true
    fi
    rm -f /tmp/get-docker.sh
    log_success "Docker успешно установлен!"
  fi

  # Проверка Docker Compose (v2 plugin или standalone v1)
  DOCKER_COMPOSE_CMD=""
  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
    log_success "Используется Docker Compose (Plugin v2): $(docker compose version)"
  elif has_command docker-compose; then
    DOCKER_COMPOSE_CMD="docker-compose"
    log_success "Используется docker-compose (Standalone v1): $(docker-compose --version)"
  else
    log_warn "Docker Compose не найден. Попытка установки плагина compose..."
    if [[ "$OS_TYPE" == "Linux" ]]; then
      if has_command apt-get; then
        sudo apt-get update -y && sudo apt-get install -y docker-compose-plugin || true
      elif has_command yum; then
        sudo yum install -y docker-compose-plugin || true
      fi
    fi

    if docker compose version >/dev/null 2>&1; then
      DOCKER_COMPOSE_CMD="docker compose"
      log_success "Docker Compose Plugin успешно установлен!"
    else
      log_error "Не удалось найти или установить Docker Compose. Пожалуйста, установите docker-compose-plugin."
      exit 1
    fi
  fi
}

check_and_install_docker

# 3. Подготовка структуры каталогов и прав доступа
log_info "Подготовка каталогов данных..."
mkdir -p "$PROJECT_DIR/data"
mkdir -p "$PROJECT_DIR/backups"
chmod 750 "$PROJECT_DIR/data" || true
log_success "Каталоги ./data и ./backups готовы."

# 4. Проверка файла конфигурации .env
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  if [[ -f "$PROJECT_DIR/.env.example" ]]; then
    log_info "Создание файла .env из шаблона .env.example..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    log_success "Файл .env создан с безопасными настройками по умолчанию."
  else
    log_info "Создание стандартного файла .env..."
    cat <<EOF > "$PROJECT_DIR/.env"
NODE_ENV=production
PORT=3000
BIND_IP=0.0.0.0
DB_PATH=/app/data/kow.db
EOF
    log_success "Файл .env успешно сгенерирован."
  fi
else
  log_info "Используется существующий файл конфигурации .env."
fi

# 5. Сборка и запуск контейнеров
log_info "Сборка Docker-образа и запуск контейнеров в фоновом режиме..."
$DOCKER_COMPOSE_CMD up -d --build

# 6. Проверка доступности (Healthcheck)
log_info "Ожидание инициализации сервера KoW Tracker..."
HEALTHCHECK_URL="http://127.0.0.1:3000/"
MAX_ATTEMPTS=20
ATTEMPT=1
SERVER_UP=false

while [[ $ATTEMPT -le $MAX_ATTEMPTS ]]; do
  if has_command curl; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTHCHECK_URL" || true)
  elif has_command wget; then
    HTTP_CODE=$(wget --server-response --spider "$HEALTHCHECK_URL" 2>&1 | awk '/HTTP\// {print $2}' | tail -1 || true)
  else
    HTTP_CODE="200"
  fi

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "301" || "$HTTP_CODE" == "302" ]]; then
    SERVER_UP=true
    break
  fi

  echo -n "."
  sleep 1
  ATTEMPT=$((ATTEMPT + 1))
done
echo ""

if [[ "$SERVER_UP" == true ]]; then
  log_success "Сервер успешно запущен и отвечает на порту 3000 (HTTP $HTTP_CODE)!"
else
  log_warn "Сервер запущен в контейнере, но Healthcheck не вернул 200 за $MAX_ATTEMPTS сек."
  log_info "Проверьте логи контейнера: $DOCKER_COMPOSE_CMD logs"
fi

# 7. Определение IP-адреса для вывода
SERVER_IP="localhost"
if has_command curl; then
  PUBLIC_IP=$(curl -s -m 2 https://api.ipify.org || true)
  if [[ -n "$PUBLIC_IP" ]]; then
    SERVER_IP="$PUBLIC_IP"
  fi
fi

echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}🎉 РАЗВЕРТЫВАНИЕ KOW TRACKER УСПЕШНО ЗАВЕРШЕНО!${RESET}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "🌐 **Веб-интерфейс:**"
echo -e "   • Локально:    ${BOLD}http://localhost:3000${RESET}"
if [[ "$SERVER_IP" != "localhost" ]]; then
  echo -e "   • По сети/IP:  ${BOLD}http://${SERVER_IP}:3000${RESET}"
fi
echo ""
echo -e "🔐 **Доступ администратора по умолчанию:**"
echo -e "   • Логин:  ${BOLD}admin${RESET}"
echo -e "   • Пароль: ${BOLD}admin123${RESET}"
echo -e "   • Роль:   ${BOLD}R5 (Лидер альянса)${RESET}"
echo ""
echo -e "🛡️  ${YELLOW}${BOLD}ВАЖНО ПО БЕЗОПАСНОСТИ:${RESET}"
echo -e "   1. Смените пароль учетной записи ${BOLD}admin${RESET} сразу после первого входа!"
echo -e "   2. Для работы мобильного PWA настройте домен и бесплатный SSL-сертификат (HTTPS):"
echo -e "      Пример конфигурации Nginx: ${BOLD}deploy/nginx/kow-tracker.conf${RESET}"
echo ""
echo -e "📋 **Управление сервисом:**"
echo -e "   • Просмотр логов в реальном времени:  ${BOLD}$DOCKER_COMPOSE_CMD logs -f${RESET}"
echo -e "   • Перезапуск контейнера:              ${BOLD}$DOCKER_COMPOSE_CMD restart${RESET}"
echo -e "   • Остановка сервиса:                  ${BOLD}$DOCKER_COMPOSE_CMD down${RESET}"
echo -e "   • Создание бэкапа базы данных:        ${BOLD}./deploy/scripts/backup.sh${RESET}"
echo ""
