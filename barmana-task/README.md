# بارمانا تسک

وب‌اپ فارسی، راست‌چین و واکنش‌گرا برای مدیریت پروژه‌های فنی، تخصیص تسک، ثبت زمان واقعی کار، تحویل، بازبینی و گزارش روزانه تیم.

## استک فنی

- **Frontend:** React 18، Vite، React Router و Axios
- **Backend:** Node.js 20+، Express، JWT و MySQL2
- **Database:** MySQL 8.0+ با Migration نسخه‌دار
- **Deployment:** Docker Compose، Nginx و Health Check
- **UI:** طراحی مینیمال شرکتی، RTL و مناسب دسکتاپ و موبایل

## قابلیت‌های نهایی

### نقش‌ها و دسترسی

- ادمین: مدیریت کاربران، همه پروژه‌ها، همه تسک‌ها، تایمرهای فعال، گزارش‌ها و تاریخچه رویدادها
- مدیر پروژه: کنترل پروژه‌های خودش، تعریف و ویرایش تسک، تخصیص عضو، بازبینی و تأیید یا برگشت تحویل
- برنامه‌نویس: مشاهده پروژه‌های عضو، اجرای تایمر، ثبت ریز زمان، تحویل تسک و گزارش روزانه
- کنترل دسترسی در API؛ مخفی‌کردن منو در فرانت‌اند تنها لایه ظاهری است

### پروژه و تسک

- ایجاد و ویرایش پروژه، کد یکتا، مدیر، اعضا، وضعیت، تاریخ شروع و تاریخ هدف
- جلوگیری از حذف عضو دارای تسک باز و جلوگیری از تکمیل/آرشیو پروژه دارای تسک باز
- ایجاد و ویرایش تسک، اولویت، مهلت، زمان تخمینی و مسئول
- شماره‌گذاری خودکار تسک‌ها در هر پروژه از `01` و مرتب‌سازی بر اساس اولویت
- مراحل اجرایی نامحدود در قالب چک‌لیست؛ برنامه‌نویس هر مرحله را تیک می‌زند و تا تکمیل همه مراحل امکان ارسال برای بازبینی ندارد
- کارت‌های فشرده: سه ستون برای ادمین و چهار ستون برای مدیر پروژه و برنامه‌نویس در نمایشگرهای عریض
- فیلتر و جست‌وجو بر اساس پروژه، وضعیت، اولویت و موعد
- صفحه جزئیات تسک شامل شرح، تحویل، نظر مدیر، ریز زمان‌ها و گفت‌وگو
- لینک تحویل برای Pull Request، Commit، نسخه تست یا مستندات

### تایمر و گردش تحویل

- فقط یک تایمر فعال برای هر برنامه‌نویس با Unique Constraint دیتابیس
- شروع/توقف تراکنشی و ثبت یادداشت هر بازه
- محاسبه زمان زنده برای تایمرهای باز
- ارسال تسک برای بازبینی فقط پس از توقف تایمر همان تسک
- تأیید نهایی یا برگشت برای اصلاح با توضیح اجباری

### ارتباطات و گزارش

- پیام داخلی روی هر تسک و حذف پیام توسط نویسنده یا ادمین
- اعلان برای تخصیص تسک، عضویت پروژه، تحویل، نظر مدیر و پیام جدید
- نشان اعلان خوانده‌نشده و علامت‌گذاری تکی یا گروهی
- گزارش روزانه قابل ثبت و ویرایش برای هر پروژه و تاریخ
- گزارش پایان روز داخل هر تسک؛ برنامه‌نویس توضیح می‌دهد امروز دقیقاً چه کاری روی همان تسک انجام داده است
- فیلتر گزارش‌ها و ریز زمان‌ها
- خروجی CSV از ریز زمان‌ها
- Audit Log برای عملیات مهم

### امنیت و عملیات

- JWT با زمان انقضا
- Hash رمز عبور با bcrypt و جلوگیری از ثبت رمز خام در Audit Log
- تغییر رمز عبور توسط کاربر
- غیرفعال‌سازی یا حذف کامل حساب توسط ادمین؛ هنگام حذف، عضویت‌های پروژه پاک و تسک‌ها بدون مسئول می‌شوند
- Rate Limit روی ورود، Helmet، محدودیت اندازه JSON و CORS
- Health Check برای API و MySQL
- Migration خودکار بدون Reset داده در Startup کانتینر
- Seed آزمایشی اختیاری و idempotent

## ساختار پروژه

```text
barmana-task/
├── backend/
│   ├── scripts/
│   │   ├── migrateDatabase.js
│   │   ├── seedDatabase.js
│   │   └── setupDatabase.js
│   └── src/
│       ├── config/
│       ├── middleware/
│       ├── routes/
│       ├── utils/
│       └── server.js
├── database/
│   ├── migrations/
│   └── schema.sql
├── docs/
│   ├── API.md
│   └── DEPLOYMENT.md
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   └── styles/
│   └── nginx.conf
├── .env.example
└── docker-compose.yml
```

## اجرای سریع با Docker

پیش‌نیاز: Docker Engine و Docker Compose v2.

```bash
cp .env.example .env
```

مقادیر `MYSQL_PASSWORD`، `MYSQL_ROOT_PASSWORD` و `JWT_SECRET` را در `.env` تغییر دهید. سپس:

```bash
docker compose up -d --build
```

در اولین اجرا، Migrationها خودکار اعمال می‌شوند. اگر `SEED_DEMO=true` باشد، داده‌های آزمایشی فقط در دیتابیس خالی ساخته می‌شوند.

آدرس وب‌اپ:

```text
http://localhost:8080
```

مشاهده وضعیت سرویس‌ها:

```bash
docker compose ps
docker compose logs -f backend
```

توقف بدون حذف داده:

```bash
docker compose down
```

حذف کامل دیتابیس آزمایشی:

```bash
docker compose down -v
```

## اجرای توسعه محلی

پیش‌نیازها:

- Node.js 20 یا جدیدتر
- npm 10 یا جدیدتر
- MySQL 8

نصب وابستگی‌ها:

```bash
npm run install:all
```

تنظیم بک‌اند:

```bash
cd backend
cp .env.example .env
npm run db:migrate
SEED_DEMO=true npm run db:seed
npm run dev
```

تنظیم فرانت‌اند در ترمینال دوم:

```bash
cd frontend
cp .env.example .env
npm run dev
```

آدرس‌ها:

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000/api`
- Health Check: `http://localhost:4000/api/health`

## حساب‌های آزمایشی

این حساب‌ها فقط وقتی ساخته می‌شوند که `SEED_DEMO=true` باشد و کاربر `admin` از قبل وجود نداشته باشد.

| نقش | نام کاربری | رمز عبور |
|---|---|---|
| ادمین | `admin` | `Admin123!` |
| مدیر پروژه | `manager` | `Manager123!` |
| برنامه‌نویس | `developer` | `Developer123!` |
| برنامه‌نویس دوم | `developer2` | `Developer123!` |

در محیط واقعی بعد از ورود، رمزها را تغییر دهید و `SEED_DEMO=false` بگذارید.

## به‌روزرسانی اجرای تسک

Migration `006_task_execution_enhancements.sql` شماره‌گذاری تسک، چک‌لیست مراحل و گزارش روزانه داخل تسک را بدون حذف داده‌های قبلی اضافه می‌کند.

Migration `009_task_checklist_descriptions.sql` امکان ثبت توضیحات مستقل برای هر ریزتسک/مرحله را بدون حذف یا تغییر اطلاعات موجود اضافه می‌کند.

## دستورات دیتابیس

اعمال Migrationهای جدید بدون پاک‌شدن داده:

```bash
npm run db:migrate
```

Seed اختیاری:

```bash
SEED_DEMO=true npm run db:seed
```

Reset کامل دیتابیس توسعه و ایجاد داده نمونه:

```bash
npm run db:setup
```

> `db:setup` همه جدول‌ها و داده‌های دیتابیس انتخاب‌شده را حذف می‌کند؛ روی Production اجرا نشود.

## بررسی کد

```bash
npm run check
```

برای Build فرانت‌اند:

```bash
npm run build:web
```

## استقرار روی سرور

راهنمای دامنه، HTTPS، Reverse Proxy، Secretها، Backup و به‌روزرسانی بدون حذف داده در فایل زیر آمده است:

```text
docs/DEPLOYMENT.md
```

## API

فهرست Endpointها، نقش‌های مجاز و نمونه Payloadها:

```text
docs/API.md
```


## Security and role update
- Demo credentials are not displayed on the login page.
- Project managers can create projects and manage project members.
- The Senior_Developer account receives an explicit, auditable secondary admin role and can switch workspaces from the profile page. The secondary role remains visible to administrators.
