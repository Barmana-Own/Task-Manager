export const REVIEW_CRITERIA = [
  { key: 'on_time', label: 'آن‌تایم بودن' },
  { key: 'responsibility', label: 'مسئولیت‌پذیری' },
  { key: 'speed', label: 'سرعت اجرا' },
  { key: 'accuracy', label: 'درستی اجرا' },
  { key: 'quality', label: 'کیفیت خروجی' },
  { key: 'communication', label: 'ارتباط و هماهنگی' },
  { key: 'problem_solving', label: 'حل مسئله' },
  { key: 'documentation', label: 'مستندسازی و تحویل' },
];

export const MANAGER_REVIEW_CRITERIA = [
  { key: 'clarity', label: 'شفافیت تسک و انتظارات' },
  { key: 'planning', label: 'برنامه‌ریزی و اولویت‌بندی' },
  { key: 'communication', label: 'ارتباط و هماهنگی' },
  { key: 'support', label: 'حمایت و رفع موانع' },
  { key: 'availability', label: 'دردسترس‌بودن' },
  { key: 'fairness', label: 'عدالت و رفتار حرفه‌ای' },
  { key: 'feedback_quality', label: 'کیفیت بازخورد' },
  { key: 'decision_making', label: 'تصمیم‌گیری و پاسخ‌گویی' },
];

function normalizeByCriteria(raw = {}, criteria) {
  return criteria.reduce((acc, item) => {
    acc[item.key] = Number(raw?.[item.key] || 0);
    return acc;
  }, {});
}

function validateByCriteria(ratings, criteria) {
  const normalized = normalizeByCriteria(ratings, criteria);
  const missing = criteria.filter((item) => !Number.isInteger(normalized[item.key]) || normalized[item.key] < 1 || normalized[item.key] > 5);
  return { valid: missing.length === 0, normalized, missing };
}

function averageByCriteria(ratings, criteria) {
  const normalized = normalizeByCriteria(ratings, criteria);
  const values = criteria.map((item) => normalized[item.key]);
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function normalizeRatings(raw = {}) {
  return normalizeByCriteria(raw, REVIEW_CRITERIA);
}

export function validateRatings(ratings) {
  return validateByCriteria(ratings, REVIEW_CRITERIA);
}

export function getAverageScore(ratings) {
  return averageByCriteria(ratings, REVIEW_CRITERIA);
}

export function validateManagerRatings(ratings) {
  return validateByCriteria(ratings, MANAGER_REVIEW_CRITERIA);
}

export function getManagerAverageScore(ratings) {
  return averageByCriteria(ratings, MANAGER_REVIEW_CRITERIA);
}
