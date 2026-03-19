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
sudo -u postgres psql << 'PGSQL'
CREATE DATABASE lpbvolley;
CREATE USER lpbvolley WITH PASSWORD 'LpbVolley2026!';
GRANT ALL PRIVILEGES ON DATABASE lpbvolley TO lpbvolley;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
PGSQL

# ── 5. Восстановление данных из бэкапа ───────────────────────
echo "[5/9] Восстановление базы данных из бэкапа..."
# Бэкап должен быть рядом со скриптом
BACKUP_FILE="$(dirname "$0")/lpbvolley_backup_20260319.sql"
if [ -f "$BACKUP_FILE" ]; then
    sudo -u postgres psql lpbvolley < "$BACKUP_FILE"
    echo "    ✓ Бэкап восстановлен"
else
    echo "    ⚠ Файл бэкапа не найден: $BACKUP_FILE"
    echo "    Загрузите бэкап и выполните:"
    echo "    sudo -u postgres psql lpbvolley < lpbvolley_backup_20260319.sql"
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
cat > /etc/postgrest.conf << 'EOF'
db-uri = "postgres://lpbvolley:LpbVolley2026!@localhost:5432/lpbvolley"
db-schema = "public"
db-anon-role = "anon"
server-port = 3000
server-host = "127.0.0.1"
jwt-secret = "lpbvolley-super-secret-jwt-key-2026"
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
mkdir -p /var/www/ipt
git clone https://github.com/t9923503503/2003.git /var/www/ipt
chown -R www-data:www-data /var/www/ipt

# config.js (секреты — не в репо)
cat > /var/www/ipt/config.js << 'EOF'
window.APP_CONFIG = {
  supabaseUrl:     'https://sv-ugra.ru/api',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.fOS7KmYRYuiSmfSzeEP17scSIMkbEejUPllW_nSHr9M',
};
EOF

# Скрипт деплоя
cat > /usr/local/bin/deploy-ipt << 'DEPLOY'
#!/bin/bash
cd /var/www/ipt
git pull origin main
chown -R www-data:www-data /var/www/ipt
echo 'Deploy done: ' $(date)
DEPLOY
chmod +x /usr/local/bin/deploy-ipt

# ── 8. nginx ──────────────────────────────────────────────────
echo "[8/9] Настройка nginx..."
cat > /etc/nginx/sites-available/ipt << 'EOF'
server {
    listen 80;
    server_name sv-ugra.ru www.sv-ugra.ru 157.22.173.248;
    root /var/www/ipt;
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
certbot --nginx -d sv-ugra.ru -d www.sv-ugra.ru --non-interactive --agree-tos -m admin@sv-ugra.ru

# Финальная проверка
echo ""
echo "========================================"
echo " ГОТОВО! Проверка сервисов:"
echo "========================================"
systemctl is-active postgresql && echo "  ✓ PostgreSQL 16"  || echo "  ✗ PostgreSQL — ошибка"
systemctl is-active postgrest  && echo "  ✓ PostgREST"      || echo "  ✗ PostgREST — ошибка"
systemctl is-active nginx      && echo "  ✓ nginx"          || echo "  ✗ nginx — ошибка"
echo ""
echo "  Сайт:  https://sv-ugra.ru"
echo "  API:   https://sv-ugra.ru/api/rest/v1/tournaments"
echo ""
echo " Добавь SSH-ключ нового сервера в GitHub если нужно деплоить через git"
