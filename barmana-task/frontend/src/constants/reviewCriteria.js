export const REVIEW_CRITERIA = [
  { key: 'on_time', label: 'آن‌تایم بودن', hint: 'تحویل در زمان مقرر و پایبندی به مهلت.' },
  { key: 'responsibility', label: 'مسئولیت‌پذیری', hint: 'پیگیری کار، پاسخ‌گویی و مالکیت نسبت به تسک.' },
  { key: 'speed', label: 'سرعت اجرا', hint: 'سرعت مناسب در پیشبرد و تحویل کار.' },
  { key: 'accuracy', label: 'درستی اجرا', hint: 'صحت نتیجه نهایی و کم‌بودن خطا.' },
  { key: 'quality', label: 'کیفیت خروجی', hint: 'کیفیت فنی، تمیزی و پایداری کار.' },
  { key: 'communication', label: 'ارتباط و هماهنگی', hint: 'همکاری مؤثر با مدیر پروژه و تیم.' },
  { key: 'problem_solving', label: 'حل مسئله', hint: 'توانایی تحلیل و رفع موانع اجرایی.' },
  { key: 'documentation', label: 'مستندسازی و تحویل', hint: 'ثبت توضیحات، لینک تحویل و شفافیت خروجی.' },
];

export const MANAGER_REVIEW_CRITERIA = [
  { key: 'clarity', label: 'شفافیت تسک و انتظارات', hint: 'شرح روشن کار، خروجی مورد انتظار و معیار پذیرش.' },
  { key: 'planning', label: 'برنامه‌ریزی و اولویت‌بندی', hint: 'تخصیص منطقی کار و تعیین اولویت‌های درست.' },
  { key: 'communication', label: 'ارتباط و هماهنگی', hint: 'انتقال دقیق اطلاعات و هماهنگی مستمر با تیم.' },
  { key: 'support', label: 'حمایت و رفع موانع', hint: 'کمک به رفع موانع و فراهم‌کردن منابع موردنیاز.' },
  { key: 'availability', label: 'دردسترس‌بودن', hint: 'پاسخ‌گویی مناسب در زمان نیاز برنامه‌نویس.' },
  { key: 'fairness', label: 'عدالت و رفتار حرفه‌ای', hint: 'رفتار منصفانه، محترمانه و بدون تبعیض.' },
  { key: 'feedback_quality', label: 'کیفیت بازخورد', hint: 'بازخورد دقیق، کاربردی و قابل اجرا.' },
  { key: 'decision_making', label: 'تصمیم‌گیری و پاسخ‌گویی', hint: 'تصمیم‌گیری به‌موقع و مسئولیت‌پذیری مدیریتی.' },
];

export const defaultReviewRatings = () => REVIEW_CRITERIA.reduce((acc, item) => ({ ...acc, [item.key]: 5 }), {});
export const defaultManagerReviewRatings = () => MANAGER_REVIEW_CRITERIA.reduce((acc, item) => ({ ...acc, [item.key]: 5 }), {});

export function getAverageRating(ratings, criteria = REVIEW_CRITERIA) {
  const values = criteria.map((item) => Number(ratings?.[item.key] || 0)).filter(Boolean);
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
