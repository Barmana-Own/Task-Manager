const statusMap = {
  planning: ['برنامه‌ریزی', 'neutral'], active: ['فعال', 'success'], on_hold: ['متوقف', 'warning'],
  completed: ['تکمیل‌شده', 'info'], archived: ['آرشیو', 'neutral'],
  todo: ['برای انجام', 'neutral'], in_progress: ['در حال انجام', 'info'], review: ['در انتظار بازبینی', 'warning'],
  changes_requested: ['نیازمند اصلاح', 'danger'], done: ['انجام‌شده', 'success'],
};
const priorityMap = {
  low: ['کم', 'neutral'], medium: ['متوسط', 'info'], high: ['زیاد', 'warning'], urgent: ['فوری', 'danger'],
};
const roleMap = { admin: 'ادمین', project_manager: 'مدیر پروژه', developer: 'برنامه‌نویس' };

export function Badge({ type = 'status', value }) {
  const map = type === 'priority' ? priorityMap : statusMap;
  const [label, tone] = map[value] || [value || '—', 'neutral'];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function RoleLabel({ role }) { return roleMap[role] || role; }

export function EmptyState({ title = 'موردی وجود ندارد', text = 'اطلاعاتی برای نمایش ثبت نشده است.' }) {
  return <div className="empty-state"><div className="empty-icon">□</div><strong>{title}</strong><p>{text}</p></div>;
}

export function PageHeader({ title, subtitle, action }) {
  return <div className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function Toast({ message, tone = 'success', onClose }) {
  if (!message) return null;
  return <div className={`toast toast-${tone}`}><span>{message}</span><button onClick={onClose}>×</button></div>;
}

export function formatDuration(seconds = 0) {
  const total = Math.max(0, Number(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  try {
    let normalized = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T12:00:00';
    else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) normalized = normalized.replace(' ', 'T');
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(normalized));
  } catch { return value; }
}
