#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# KoW Tracker - Автоматизированный скрипт развертывания
# Использование:
#   chmod +x deploy.sh && ./deploy.sh
# Или с автоматической настройкой Nginx и SSL (HTTPS):
#   ./deploy.sh --domain kow.example.com --email admin@example.com
# Или полностью неинтерактивный режим:
#   ./deploy.sh --auto --skip-ssl
# ─────────────────────────────────────────────────────────────

set -euo pipefail

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

AUTO_MODE=false
DOMAIN=""
EMAIL=""
SKIP_SSL=false
WITH_SSL=false

# 0. Разбор аргументов командной строки
print_help() {
  echo -e "${BOLD}KoW Tracker — Скрипт автоматического развертывания${RESET}"
  echo ""
  echo "Использование:"
  echo "  ./deploy.sh [ОПЦИИ]"
  echo ""
  echo "Опции:"
  echo "  --auto, -y              Тихий автоматический режим (без интерактивных вопросов)"
  echo "  --domain <domain>       Доменное имя для Nginx и выпуска SSL (например, kow.example.com)"
  echo "  --email <email>         Email для уведомлений Let's Encrypt Certbot"
  echo "  --skip-ssl, --no-ssl    Пропустить установку Nginx и выпуск SSL-сертификата"
  echo "  --ssl, --with-ssl       Включить процедуру настройки Nginx и SSL"
  echo "  -h, --help              Показать эту справку и выйти"
  echo ""
  echo "Примеры:"
  echo "  ./deploy.sh"
  echo "  ./deploy.sh --domain kow.myalliance.ru --email admin@myalliance.ru"
  echo "  ./deploy.sh --auto --skip-ssl"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto|-y)
      AUTO_MODE=true
      shift
      ;;
    --domain=*)
      DOMAIN="${1#*=}"
      shift
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2 || true
      ;;
    --email=*)
      EMAIL="${1#*=}"
      shift
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2 || true
      ;;
    --skip-ssl|--no-ssl)
      SKIP_SSL=true
      shift
      ;;
    --ssl|--with-ssl)
      WITH_SSL=true
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      log_warn "Неизвестный параметр: $1 (будет проигнорирован)"
      shift
      ;;
  esac
done

# Очистка и санитизация домена
if [[ -n "$DOMAIN" ]]; then
  DOMAIN="$(echo "$DOMAIN" | sed -e 's|^https*://||' -e 's|/.*$||' | tr -d '[:space:]')"
fi
if [[ -n "$EMAIL" ]]; then
  EMAIL="$(echo "$EMAIL" | tr -d '[:space:]')"
fi

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
BIND_IP=127.0.0.1
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

# 8. Настройка Nginx и выпуск SSL-сертификата Let's Encrypt (HTTPS)
SSL_CONFIGURED=false

setup_nginx_and_ssl() {
  if [[ "$SKIP_SSL" == true ]]; then
    log_info "Настройка Nginx и SSL пропущена пользователем (--skip-ssl)."
    return 0
  fi

  # Интерактивный запрос, если домен не был передан в аргументах и не включен тихий режим
  if [[ -z "$DOMAIN" ]]; then
    if [[ "$AUTO_MODE" == true ]]; then
      log_info "Автоматический режим (--auto): для настройки Nginx и SSL передайте флаги --domain <домен> и --email <email>."
      return 0
    fi

    echo ""
    echo -e "${BOLD}${BLUE}╔════════════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${BLUE}║        Настройка обратного прокси Nginx и SSL-сертификата          ║${RESET}"
    echo -e "${BOLD}${BLUE}╚════════════════════════════════════════════════════════════════════╝${RESET}"
    echo ""
    echo -e "Для работы мобильного приложения (PWA) и безопасного доступа рекомендуется"
    echo -e "настроить доменное имя и бесплатный SSL-сертификат Let's Encrypt (HTTPS)."
    echo ""
    read -rp "Настроить Nginx и выпустить SSL-сертификат Let's Encrypt прямо сейчас? [y/N]: " setup_choice

    if [[ ! "$setup_choice" =~ ^[YyДд] ]]; then
      log_info "Настройка Nginx и SSL отложена. Вы можете выполнить ее позже вручную по README.md."
      return 0
    fi

    while [[ -z "$DOMAIN" ]]; do
      read -rp "Введите доменное имя (например, kow.myalliance.ru): " raw_domain
      DOMAIN="$(echo "$raw_domain" | sed -e 's|^https*://||' -e 's|/.*$||' | tr -d '[:space:]')"
      if [[ -z "$DOMAIN" ]]; then
        log_warn "Доменное имя не может быть пустым."
      fi
    done

    read -rp "Введите контактный email для Let's Encrypt (или оставьте пустым): " raw_email
    EMAIL="$(echo "$raw_email" | tr -d '[:space:]')"
  fi

  if [[ "$OS_TYPE" != "Linux" ]]; then
    log_warn "Автоматическая установка Nginx и Certbot поддерживается только на Linux."
    log_warn "На $OS_TYPE используйте ручную настройку обратного прокси."
    return 0
  fi

  # Команда повышения привилегий
  SUDO_CMD=""
  if [[ "$EUID" -ne 0 ]]; then
    if has_command sudo; then
      SUDO_CMD="sudo"
    else
      log_error "Для настройки Nginx и Certbot требуются права root или sudo."
      return 1
    fi
  fi

  log_info "Проверка и установка Nginx и Certbot..."
  if has_command apt-get; then
    $SUDO_CMD apt-get update -y
    $SUDO_CMD apt-get install -y nginx certbot python3-certbot-nginx
  elif has_command dnf; then
    $SUDO_CMD dnf install -y epel-release || true
    $SUDO_CMD dnf install -y nginx certbot python3-certbot-nginx
  elif has_command yum; then
    $SUDO_CMD yum install -y epel-release || true
    $SUDO_CMD yum install -y nginx certbot python3-certbot-nginx
  else
    log_warn "Неизвестный пакетный менеджер. Убедитесь, что nginx и certbot установлены в системе."
  fi

  # Открытие портов в фаерволе UFW (если активен)
  if has_command ufw; then
    if $SUDO_CMD ufw status 2>/dev/null | grep -q "Status: active"; then
      log_info "Открытие портов 80 и 443 в UFW..."
      $SUDO_CMD ufw allow 80/tcp || true
      $SUDO_CMD ufw allow 443/tcp || true
      log_success "Порты 80 и 443 разрешены в брандмауэре."
    fi
  fi

  # Определение пути конфигурации Nginx
  NGINX_CONF_DEST=""
  IS_DEBIAN_STYLE=false
  if [[ -d "/etc/nginx/sites-available" ]]; then
    NGINX_CONF_DEST="/etc/nginx/sites-available/kow-tracker.conf"
    IS_DEBIAN_STYLE=true
  else
    $SUDO_CMD mkdir -p /etc/nginx/conf.d
    NGINX_CONF_DEST="/etc/nginx/conf.d/kow-tracker.conf"
  fi

  # Создание каталога проверки ACME challenge
  $SUDO_CMD mkdir -p /var/www/certbot
  $SUDO_CMD chmod 755 /var/www/certbot || true

  # Проверяем, существует ли уже выпущенный сертификат
  CERT_EXISTS=false
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" && -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]]; then
    CERT_EXISTS=true
    log_info "Обнаружен ранее выпущенный действующий сертификат для ${DOMAIN}."
  fi

  # Если сертификата нет — создаем временный HTTP-сервер для прохождения Let's Encrypt
  if [[ "$CERT_EXISTS" != true ]]; then
    log_info "Создание временной конфигурации Nginx (порт 80) для выпуска сертификата..."
    cat <<TEMP_HTTP | $SUDO_CMD tee "$NGINX_CONF_DEST" >/dev/null
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
TEMP_HTTP

    if [[ "$IS_DEBIAN_STYLE" == true ]]; then
      $SUDO_CMD ln -sf "$NGINX_CONF_DEST" /etc/nginx/sites-enabled/kow-tracker.conf
      if [[ -f /etc/nginx/sites-enabled/default ]]; then
        $SUDO_CMD rm -f /etc/nginx/sites-enabled/default
      fi
    fi

    if $SUDO_CMD nginx -t >/dev/null 2>&1; then
      $SUDO_CMD systemctl enable --now nginx || true
      $SUDO_CMD systemctl reload nginx || $SUDO_CMD systemctl restart nginx || true
      log_success "Временный HTTP-сервер запущен."
    else
      log_error "Ошибка проверки конфигурации Nginx. Проверьте логи: sudo nginx -t"
      return 1
    fi

    log_info "Запрос SSL-сертификата Let's Encrypt для домена ${DOMAIN}..."
    CERTBOT_EMAIL_FLAG=""
    if [[ -n "$EMAIL" ]]; then
      CERTBOT_EMAIL_FLAG="--email ${EMAIL}"
    else
      CERTBOT_EMAIL_FLAG="--register-unsafely-without-email"
    fi

    if $SUDO_CMD certbot certonly --webroot -w /var/www/certbot -d "${DOMAIN}" --non-interactive --agree-tos $CERTBOT_EMAIL_FLAG; then
      log_success "SSL-сертификат Let's Encrypt успешно получен!"
      CERT_EXISTS=true
    else
      log_warn "Не удалось автоматически выпустить SSL-сертификат через Certbot."
      log_warn "Возможные причины: DNS A-запись для ${DOMAIN} еще не указывает на $SERVER_IP или порт 80 заблокирован хостером."
      log_info "Временный HTTP-прокси активен: сайт доступен по адресу http://${DOMAIN}"
      log_info "После обновления DNS выпустите сертификат вручную: sudo certbot --nginx -d ${DOMAIN}"
    fi
  fi

  # Если сертификат успешно выпущен или уже существовал — применяем полную защищенную конфигурацию
  if [[ "$CERT_EXISTS" == true ]]; then
    log_info "Применение production-конфигурации Nginx с поддержкой SSL, HSTS и PWA..."
    sed -e "s|your-domain.com www.your-domain.com|${DOMAIN}|g" \
        -e "s|your-domain.com|${DOMAIN}|g" \
        "$PROJECT_DIR/deploy/nginx/kow-tracker.conf" | $SUDO_CMD tee "$NGINX_CONF_DEST" >/dev/null

    if [[ "$IS_DEBIAN_STYLE" == true ]]; then
      $SUDO_CMD ln -sf "$NGINX_CONF_DEST" /etc/nginx/sites-enabled/kow-tracker.conf
    fi

    if $SUDO_CMD nginx -t >/dev/null 2>&1; then
      $SUDO_CMD systemctl reload nginx
      log_success "Nginx успешно настроен и перезагружен с активным HTTPS!"
      $SUDO_CMD systemctl enable --now certbot.timer 2>/dev/null || true
      SSL_CONFIGURED=true
    else
      log_error "Ошибка в итоговой конфигурации Nginx. Проверьте: sudo nginx -t"
      return 1
    fi
  fi
}

setup_nginx_and_ssl || log_warn "Настройка Nginx/SSL завершилась с предупреждениями (основной контейнер трекера работает нормально)."

echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}🎉 РАЗВЕРТЫВАНИЕ KOW TRACKER УСПЕШНО ЗАВЕРШЕНО!${RESET}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "🌐 **Веб-интерфейс:**"
if [[ "$SSL_CONFIGURED" == true ]]; then
  echo -e "   • Безопасный доступ (HTTPS): ${BOLD}${GREEN}https://${DOMAIN}${RESET}"
  echo -e "   • Локальный порт:            ${BOLD}http://localhost:3000${RESET}"
else
  if [[ -n "$DOMAIN" ]]; then
    echo -e "   • По доменному имени (HTTP): ${BOLD}http://${DOMAIN}${RESET}"
  fi
  echo -e "   • Локально:                  ${BOLD}http://localhost:3000${RESET}"
  if [[ "$SERVER_IP" != "localhost" ]]; then
    echo -e "   • По сети / внешнему IP:     ${BOLD}http://${SERVER_IP}:3000${RESET}"
  fi
fi
echo ""
echo -e "🔐 **Доступ администратора по умолчанию:**"
echo -e "   • Логин:  ${BOLD}admin${RESET}"
echo -e "   • Пароль: ${BOLD}admin123${RESET}"
echo -e "   • Роль:   ${BOLD}R5 (Лидер альянса)${RESET}"
echo ""
echo -e "🛡️  ${YELLOW}${BOLD}ВАЖНО ПО БЕЗОПАСНОСТИ:${RESET}"
echo -e "   1. Смените пароль учетной записи ${BOLD}admin${RESET} сразу после первого входа!"
if [[ "$SSL_CONFIGURED" != true ]]; then
  echo -e "   2. Для работы мобильного PWA настройте домен и бесплатный SSL-сертификат (HTTPS):"
  echo -e "      Пример конфигурации Nginx: ${BOLD}deploy/nginx/kow-tracker.conf${RESET}"
  echo -e "      Или запустите: ${BOLD}./deploy.sh --domain <ваш-домен> --email <ваш-email>${RESET}"
fi
echo ""
echo -e "📋 **Управление сервисом:**"
echo -e "   • Просмотр логов в реальном времени:  ${BOLD}$DOCKER_COMPOSE_CMD logs -f${RESET}"
echo -e "   • Перезапуск контейнера:              ${BOLD}$DOCKER_COMPOSE_CMD restart${RESET}"
echo -e "   • Остановка сервиса:                  ${BOLD}$DOCKER_COMPOSE_CMD down${RESET}"
echo -e "   • Создание бэкапа базы данных:        ${BOLD}./deploy/scripts/backup.sh${RESET}"
echo ""
