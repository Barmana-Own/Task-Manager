import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import { EmptyState, formatDate, PageHeader, RoleLabel } from '../components/UI.jsx';

const actionLabels = {
  login: 'ورود به سامانه', create: 'ایجاد', update: 'ویرایش', start: 'شروع تایمر', stop: 'توقف تایمر',
  submit_for_review: 'ارسال برای بازبینی', approve: 'تأیید تسک', request_changes: 'برگشت برای اصلاح',
  upsert: 'ثبت گزارش', delete: 'حذف', change_password: 'تغییر رمز عبور', database_seeded: 'راه‌اندازی دیتابیس',
};
const entityLabels = { auth: 'احراز هویت', user: 'کاربر', project: 'پروژه', task: 'تسک', timer: 'تایمر', report: 'گزارش', task_comment: 'پیام تسک', system: 'سامانه' };

export default function ActivitiesPage() {
  const [activities, setActivities] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/activities?limit=200').then(({ data }) => setActivities(data.activities)).catch((e) => setError(getErrorMessage(e))).finally(() => setLoading(false)); }, []);

  return (
    <>
      <PageHeader title="تاریخچه رویدادها" subtitle="ردیابی عملیات مهم و تغییرات ثبت‌شده در سامانه" />
      {error && <div className="alert alert-danger">{error}</div>}
      <section className="panel table-panel">
        {loading ? <div className="screen-center small"><div className="spinner" /></div> : activities.length ? <div className="activity-timeline">{activities.map((activity) => <div className="activity-item" key={activity.id}><div className="timeline-dot" /><div className="activity-content"><div><strong>{activity.user_name || 'سامانه'}</strong><span>{activity.user_role && <RoleLabel role={activity.user_role} />}</span></div><p><b>{actionLabels[activity.action] || activity.action}</b> روی {entityLabels[activity.entity_type] || activity.entity_type}{activity.entity_id ? ` #${activity.entity_id}` : ''}</p><time>{formatDate(activity.created_at, true)}</time></div></div>)}</div> : <EmptyState />}
      </section>
    </>
  );
}
