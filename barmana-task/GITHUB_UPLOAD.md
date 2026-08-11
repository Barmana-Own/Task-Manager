# انتشار روی GitHub

این پوشه شامل سورس برنامه است و شامل دیتابیس Production، فایل `.env` واقعی، رمزهای سرور، لاگ‌ها یا بکاپ‌های سرور نیست.

## قبل از Push

1. فایل `.env` واقعی را Commit نکنید.
2. `node_modules`، `dist`، لاگ‌ها و بکاپ‌ها را Commit نکنید.
3. برای Repository عمومی، نسخه `github-public-ready` پیشنهاد می‌شود؛ چون دسترسی ویژه‌ای که در نسخه فعلی سرور برای `Senior_Developer` وجود دارد در سورس اصلی قابل مشاهده است.

## دستورات Git

```bash
git init
git add .
git commit -m "Initial Barmana Task release"
git branch -M main
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```
