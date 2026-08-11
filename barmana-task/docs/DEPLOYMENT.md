# راهنمای استقرار Production

## ۱. آماده‌سازی سرور

حداقل پیشنهادی برای تیم کوچک:

- Ubuntu 24.04 LTS یا توزیع مشابه
- 2 vCPU
- 2 تا 4 گیگابایت RAM
- Docker Engine و Docker Compose v2
- دامنه متصل به IP سرور

## ۲. تنظیم متغیرها

```bash
cp .env.example .env
```

مقادیر زیر باید حتماً تغییر کنند:

```env
MYSQL_PASSWORD=<strong-random-password>
MYSQL_ROOT_PASSWORD=<different-strong-random-password>
JWT_SECRET=<at-least-32-random-characters>
FRONTEND_URL=https://tasks.example.com
SEED_DEMO=false
WEB_PORT=8080
```

فایل `.env` را Commit نکنید و دسترسی آن را محدود کنید:

```bash
chmod 600 .env
```

## ۳. اجرای سرویس‌ها

```bash
docker compose up -d --build
```

Backend پیش از شروع، Migrationهای اجرا‌نشده را اعمال می‌کند. داده‌ها در Volume با نام `mysql_data` نگهداری می‌شوند.

## ۴. Reverse Proxy و HTTPS

پورت `8080` را مستقیماً عمومی نکنید. Nginx یا Caddy روی Host قرار دهید و دامنه را به آن متصل کنید.

نمونه Nginx:

```nginx
server {
    listen 80;
    server_name tasks.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tasks.example.com;

    ssl_certificate /etc/letsencrypt/live/tasks.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tasks.example.com/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

گواهی را می‌توان با Certbot دریافت کرد.

## ۵. Backup دیتابیس

Backup دستی:

```bash
docker compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > backup-$(date +%F-%H%M).sql
```

بازیابی روی دیتابیس خالی:

```bash
cat backup.sql | docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
```

Backup را خارج از همان سرور نگهداری و بازیابی آن را دوره‌ای آزمایش کنید.

## ۶. به‌روزرسانی نسخه

```bash
git pull
docker compose build --pull
docker compose up -d
```

Migrationها هنگام Startup بک‌اند اجرا می‌شوند. از اجرای `db:setup` روی Production خودداری کنید.

## ۷. مشاهده Log و وضعیت

```bash
docker compose ps
docker compose logs -f --tail=200 backend
docker compose logs -f --tail=200 frontend
```

Health Check:

```bash
curl http://127.0.0.1:4000/api/health
```

## ۸. سخت‌سازی پیشنهادی

- محدودکردن SSH به کلید عمومی
- فعال‌کردن Firewall و بازکردن فقط 22، 80 و 443
- عدم انتشار پورت MySQL در Production
- تعویض دوره‌ای Secretها
- نگهداری Log مرکزی و Error Monitoring
- Backup روزانه و سیاست نگهداری چندنسخه‌ای
- فعال‌کردن 2FA و بازیابی رمز عبور در فاز سازمانی
