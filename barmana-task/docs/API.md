# مستندات API تسک‌یار

Base URL در توسعه:

```text
http://localhost:4000/api
```

تمام Endpointهای محافظت‌شده به Header زیر نیاز دارند:

```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

نقش‌ها:

- `admin`
- `project_manager`
- `developer`

## Health

### `GET /health`

بدون احراز هویت. اتصال API به MySQL را بررسی می‌کند.

## Auth

### `POST /auth/login`

```json
{
  "username": "admin",
  "password": "Admin123!"
}
```

خروجی شامل `token` و `user` است.

### `GET /auth/me`

اطلاعات کاربر جاری.

### `POST /auth/change-password`

```json
{
  "currentPassword": "OldPassword1",
  "newPassword": "NewPassword2"
}
```

## Dashboard

### `GET /dashboard`

آمار پروژه، تسک، زمان و داده‌های متناسب با نقش جاری.

## Users — فقط Admin

### `GET /users`

فهرست کاربران، نقش، وضعیت و آخرین ورود.

### `POST /users`

```json
{
  "fullName": "علی رضایی",
  "username": "ali",
  "email": "ali@example.com",
  "password": "StrongPass1",
  "role": "developer"
}
```

### `PATCH /users/:id`

همه فیلدها اختیاری‌اند:

```json
{
  "fullName": "علی رضایی",
  "email": "new@example.com",
  "role": "project_manager",
  "isActive": true,
  "password": "AnotherPass2"
}
```

### `DELETE /users/:id`

حذف دائمی کاربر. عضویت‌های پروژه حذف، تسک‌های تخصیص‌داده‌شده بدون مسئول و پروژه‌های تحت مدیریت او به ادمین حذف‌کننده منتقل می‌شوند. حذف حساب خود ادمین یا آخرین ادمین فعال مجاز نیست.

## Projects

### `GET /projects`

Queryهای اختیاری:

- `status`: `planning | active | on_hold | completed | archived`
- `q`: جست‌وجوی نام، کد یا توضیح

نتیجه بر اساس نقش محدود می‌شود.

### `GET /projects/:id`

جزئیات پروژه، اعضا، آمار تسک و زمان.

### `POST /projects` — فقط Admin

```json
{
  "name": "وب‌سایت سازمانی",
  "code": "WEB-001",
  "description": "بازطراحی کامل سایت",
  "managerId": 2,
  "memberIds": [3, 4],
  "status": "active",
  "startDate": "2026-08-03",
  "targetDate": "2026-09-15"
}
```

### `PATCH /projects/:id` — Admin یا مدیر همان پروژه

مدیر پروژه نمی‌تواند `managerId` یا `memberIds` را تغییر دهد. پروژه دارای تسک باز نیز قابل `completed` یا `archived` شدن نیست.

```json
{
  "name": "وب‌سایت سازمانی نسخه جدید",
  "description": "شرح جدید",
  "status": "on_hold",
  "startDate": "2026-08-03",
  "targetDate": "2026-09-30",
  "managerId": 2,
  "memberIds": [3, 4, 5]
}
```

## Tasks

### `GET /tasks`

Queryهای اختیاری:

- `projectId`
- `assigneeId` برای Admin و مدیر پروژه
- `status`: `todo | in_progress | review | changes_requested | done`
- `priority`: `low | medium | high | urgent`
- `due`: `overdue | today | week`
- `q`: جست‌وجوی عنوان، شرح، نام یا کد پروژه

### `GET /tasks/:id`

جزئیات کامل تسک، پیام‌ها و ریز زمان‌ها.

### `POST /tasks` — Admin یا Project Manager

```json
{
  "projectId": 1,
  "title": "پیاده‌سازی صفحه ورود",
  "description": "فرم ورود و مدیریت خطا تکمیل شود.",
  "assigneeId": 3,
  "priority": "high",
  "dueDate": "2026-08-10",
  "estimatedMinutes": 360,
  "checklistItems": [
    { "title": "طراحی فرم", "description": "طراحی حالت دسکتاپ و موبایل مطابق UI پروژه." },
    { "title": "اتصال API", "description": "مدیریت خطاهای ورود و نگهداری توکن نیز انجام شود." },
    { "title": "تست موبایل" }
  ]
}
```

### `PATCH /tasks/:id` — Admin یا مدیر همان پروژه

```json
{
  "title": "عنوان جدید",
  "description": "شرح جدید",
  "assigneeId": 4,
  "priority": "urgent",
  "dueDate": "2026-08-08",
  "estimatedMinutes": 480,
  "checklistItems": [
    { "id": 10, "title": "مرحله قبلی با عنوان جدید", "description": "توضیحات جدید مرحله" },
    { "title": "مرحله جدید", "description": "توضیحات اختیاری مرحله جدید" }
  ]
}
```

مدیر پروژه وضعیت تحویل را از این Endpoint تغییر نمی‌دهد؛ انتقال به `review` و `done` فقط از مسیرهای Workflow انجام می‌شود. تسک پروژه تکمیل‌شده یا آرشیوشده نیز تا بازگشایی پروژه قابل ویرایش نیست.

### `POST /tasks/:id/submit` — Developer

```json
{
  "completionNote": "صفحه ورود تکمیل و تست شد.",
  "completionLink": "https://git.example.com/project/merge_requests/42"
}
```

### `POST /tasks/:id/review` — Admin یا مدیر همان پروژه

تأیید:

```json
{
  "decision": "approve",
  "note": "تأیید شد."
}
```

برگشت برای اصلاح:

```json
{
  "decision": "request_changes",
  "note": "اعتبارسنجی موبایل اصلاح شود."
}
```

### `PATCH /tasks/:id/checklist/:itemId` — Developer مسئول یا Admin

```json
{
  "isCompleted": true
}
```

با تیک‌زدن اولین مرحله، وضعیت تسک از `todo` به `in_progress` تغییر می‌کند. تا زمانی که همه مراحل تکمیل نشده باشند، ارسال برای بازبینی ممکن نیست.

### `POST /tasks/:id/daily-report` — Developer مسئول

ثبت یا ویرایش گزارش همان روز روی همان تسک:

```json
{
  "body": "امروز فرم ورود و اعتبارسنجی سمت کاربر را تکمیل کردم."
}
```

کلید یکتا: `task_id + user_id + report_date`.

### `POST /tasks/:id/comments`

```json
{
  "body": "API آماده است؛ لطفاً اتصال فرانت را بررسی کن."
}
```

### `DELETE /tasks/:taskId/comments/:commentId`

فقط نویسنده پیام یا Admin.

## Timers

### `GET /timers/active`

- Admin: همه تایمرها
- Project Manager: تایمرهای پروژه‌های تحت مدیریت
- Developer: تایمر خودش

### `GET /timers/logs`

Queryهای اختیاری:

- `taskId`
- `projectId`
- `userId` برای Admin/Manager
- `dateFrom`
- `dateTo`

### `POST /timers/start` — Developer

```json
{
  "taskId": 12
}
```

هر برنامه‌نویس فقط یک تایمر فعال دارد.

### `POST /timers/stop` — Developer

```json
{
  "note": "پیاده‌سازی و تست فرم ورود"
}
```

## Reports

### `GET /reports`

Queryهای اختیاری:

- `projectId`
- `date` با فرمت `YYYY-MM-DD`

### `POST /reports`

ثبت یا ویرایش با Upsert:

```json
{
  "projectId": 1,
  "reportDate": "2026-08-03",
  "summary": "فرم ورود و تست‌های اصلی تکمیل شد.",
  "blockers": "دسترسی به SMTP هنوز آماده نیست.",
  "nextPlan": "پیاده‌سازی بازیابی رمز عبور"
}
```

کلید یکتا: `user_id + project_id + report_date`.

## Notifications

### `GET /notifications?limit=30`

فهرست اعلان‌های کاربر و تعداد خوانده‌نشده.

### `PATCH /notifications/:id/read`

خوانده‌شدن یک اعلان.

### `PATCH /notifications/read-all`

خوانده‌شدن همه اعلان‌های کاربر.

## Activities — فقط Admin

### `GET /activities?limit=200`

تاریخچه عملیات مهم. سقف `limit` برابر 500 است.

## ساختار خطا

نمونه خطای عمومی:

```json
{
  "message": "اطلاعات ورودی معتبر نیست.",
  "errors": [
    {
      "field": "title",
      "message": "عنوان تسک معتبر نیست."
    }
  ]
}
```

کدهای رایج:

- `400`: عملیات نامعتبر
- `401`: ورود لازم یا Token نامعتبر
- `403`: عدم دسترسی نقش یا مالکیت
- `404`: رکورد پیدا نشد
- `409`: تعارض، مانند تایمر هم‌زمان یا عضو دارای تسک باز
- `422`: اعتبارسنجی ورودی
- `429`: عبور از Rate Limit ورود
- `500`: خطای داخلی سرور
