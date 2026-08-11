export function notFound(req, res) {
  res.status(404).json({ message: 'مسیر موردنظر پیدا نشد.' });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'این مقدار قبلاً ثبت شده است.' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ message: 'یکی از مقادیر ارجاعی معتبر نیست.' });
  }
  const status = Number(err.status || 500);
  const isDevelopment = process.env.NODE_ENV === 'development';
  res.status(status).json({
    message: status < 500 || isDevelopment ? (err.message || 'درخواست نامعتبر است.') : 'خطای داخلی سرور رخ داد.',
    ...(isDevelopment ? { stack: err.stack } : {}),
  });
}
