#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# СКРИПТ ВОССТАНОВЛЕНИЯ СЕРВЕРА lpbvolley
# Ubuntu 24.04 + PostgreSQL 16 + PostgREST + nginx + SSL
#
# Запуск ПОСЛЕ переустановки сервера:
#   bash server_restore.sh
# ═══════════════════════════════════════════════════════════════
set -e

echo "========================================"
echo " ВОССТАНОВЛЕНИЕ СЕРВЕРА LPBVOLLEY"
echo "========================================"

# ── 0. Secrets / configuration (must be provided) ─────────────
# Usage:
#   source ./server_restore.env
#   bash server_restore.sh
#
# Required env vars:
#   DB_NAME, DB_USER, DB_PASS
#   POSTGREST_JWT_SECRET
#   SITE_DOMAIN, SITE_EMAIL
#   APP_REPO, APP_BRANCH, APP_PATH
#   APP_API_BASE, APP_SUPABASE_ANON_KEY
#
missing=0
need() {
  local k="$1"
  if [ -z "${!k:-}" ]; then
    echo " ✗ Missing env: $k"
    missing=1
  fi
}
need DB_NAME
need DB_USER
need DB_PASS
need POSTGREST_JWT_SECRET
need SITE_DOMAIN
need SITE_EMAIL
need APP_REPO
need APP_BRANCH
need APP_PATH
need APP_API_BASE
need APP_SUPABASE_ANON_KEY
if [ "$missing" -ne 0 ]; then
  echo ""
  echo "ERROR: Missing required env vars."
  echo "Create server_restore.env from server_restore.env.example and run:"
  echo "  source ./server_restore.env"
  echo "  bash server_restore.sh"
  exit 2
fi

# ── 1. Обновление системы ─────────────────────────────────────
echo "[1/9] Обновление системы..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Установка зависимостей ─────────────────────────────────
echo "[2/9] Установка nginx, git, certbot..."
apt-get install -y -qq nginx git curl wget unzip certbot python3-certbot-nginx

# ── 3. PostgreSQL 16 ──────────────────────────────────────────
echo "[3/9] Установка PostgreSQL 16..."
apt-get install -y -qq gnupg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y -qq postgresql-16

# Запускаем PostgreSQL
systemctl enable postgresql
systemctl start postgresql

# ── 4. Создание БД и пользователей ───────────────────────────
echo "[4/9] Создание базы данных lpbvolley..."
sudo -u postgres psql << PGSQL
CREATE DATABASE ${DB_NAME};
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
-- PostgREST requires: db user must be able to SET ROLE to anon/authenticated
GRANT anon TO ${DB_USER};
GRANT authenticated TO ${DB_USER};
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
PGSQL

# ── 5. Восстановление данных из бэкапа ───────────────────────
echo "[5/9] Восстановление базы данных из бэкапа..."
# Бэкап должен быть рядом со скриптом
BACKUP_FILE="$(dirname "$0")/lpbvolley_backup_20260319.sql"
if [ -f "$BACKUP_FILE" ]; then
    sudo -u postgres psql "${DB_NAME}" < "$BACKUP_FILE"
    echo "    ✓ Бэкап восстановлен"
else
    echo "    ⚠ Файл бэкапа не найден: $BACKUP_FILE"
    echo "    Загрузите бэкап и выполните:"
    echo "    sudo -u postgres psql ${DB_NAME} < lpbvolley_backup_20260319.sql"
fi

# ── 6. PostgREST ──────────────────────────────────────────────
echo "[6/9] Установка PostgREST..."
cd /tmp
PGRST_VERSION="v12.2.3"
wget -q "https://github.com/PostgREST/postgrest/releases/download/${PGRST_VERSION}/postgrest-${PGRST_VERSION}-linux-static-x64.tar.xz"
tar xf "postgrest-${PGRST_VERSION}-linux-static-x64.tar.xz"
mv postgrest /usr/local/bin/postgrest
chmod +x /usr/local/bin/postgrest

# Конфиг PostgREST
cat > /etc/postgrest.conf << EOF
db-uri = "postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
db-schema = "public"
db-anon-role = "anon"
server-port = 3000
server-host = "127.0.0.1"
jwt-secret = "${POSTGREST_JWT_SECRET}"
EOF

# systemd сервис для PostgREST
cat > /etc/systemd/system/postgrest.service << 'EOF'
[Unit]
Description=PostgREST API Server
After=postgresql.service
Requires=postgresql.service

[Service]
ExecStart=/usr/local/bin/postgrest /etc/postgrest.conf
Restart=always
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable postgrest
systemctl start postgrest

# ── 7. Сайт из GitHub ─────────────────────────────────────────
echo "[7/9] Деплой сайта из GitHub..."
mkdir -p "${APP_PATH}"
if [ -d "${APP_PATH}/.git" ]; then
  echo "    Repo exists — updating..."
  cd "${APP_PATH}"
  git fetch --all -q
  git checkout -q "${APP_BRANCH}"
  git pull -q origin "${APP_BRANCH}"
else
  git clone "${APP_REPO}" "${APP_PATH}"
fi
chown -R www-data:www-data "${APP_PATH}"

# config.js (секреты — не в репо)
cat > "${APP_PATH}/config.js" << EOF
window.APP_CONFIG = {
  supabaseUrl:     '${APP_API_BASE}',
  supabaseAnonKey: '${APP_SUPABASE_ANON_KEY}',
};
EOF

# Скрипт деплоя
cat > /usr/local/bin/deploy-ipt << DEPLOY
#!/bin/bash
set -e
cd "${APP_PATH}"
git pull origin "${APP_BRANCH}"
chown -R www-data:www-data "${APP_PATH}"
echo 'Deploy done: ' $(date)
DEPLOY
chmod +x /usr/local/bin/deploy-ipt

# ── 8. nginx ──────────────────────────────────────────────────
echo "[8/9] Настройка nginx..."
cat > /etc/nginx/sites-available/ipt << EOF
server {
    listen 80;
    server_name ${SITE_DOMAIN} www.${SITE_DOMAIN};
    root ${APP_PATH};
    index index.html;

    location /api/rest/v1/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods 'GET,POST,PATCH,PUT,DELETE,OPTIONS' always;
        add_header Access-Control-Allow-Headers 'Authorization,Content-Type,Prefer,apikey' always;
        if ($request_method = OPTIONS) { return 204; }
    }

    location /api/auth/ {
        return 200 '{}';
        add_header Content-Type application/json;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json;
}
EOF

ln -sf /etc/nginx/sites-available/ipt /etc/nginx/sites-enabled/ipt
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl restart nginx

# ── 9. SSL сертификат ─────────────────────────────────────────
echo "[9/9] Получение SSL сертификата..."
certbot --nginx -d "${SITE_DOMAIN}" -d "www.${SITE_DOMAIN}" --non-interactive --agree-tos -m "${SITE_EMAIL}"

# Финальная проверка
echo ""
echo "========================================"
echo " ГОТОВО! Проверка сервисов:"
echo "========================================"
systemctl is-active postgresql && echo "  ✓ PostgreSQL 16"  || echo "  ✗ PostgreSQL — ошибка"
systemctl is-active postgrest  && echo "  ✓ PostgREST"      || echo "  ✗ PostgREST — ошибка"
systemctl is-active nginx      && echo "  ✓ nginx"          || echo "  ✗ nginx — ошибка"
echo ""
echo "  Сайт:  https://${SITE_DOMAIN}"
echo "  API:   https://${SITE_DOMAIN}/api/rest/v1/tournaments"
echo ""
echo " Добавь SSH-ключ нового сервера в GitHub если нужно деплоить через git"
