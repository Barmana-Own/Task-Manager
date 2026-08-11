import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Badge, EmptyState, formatDate, formatDuration, PageHeader } from '../components/UI.jsx';

function StatCards({ stats, role }) {
  const cards = role === 'developer'
    ? [
      ['پروژه‌های من', stats.active_projects || 0, `${stats.total_projects || 0} پروژه در دسترس`, '▣'],
      ['در حال انجام', stats.in_progress_tasks || 0, `${stats.todo_tasks || 0} تسک آماده شروع`, '◷'],
      ['در انتظار بازبینی', stats.review_tasks || 0, `${stats.done_tasks || 0} تسک تکمیل‌شده`, '◎'],
      ['زمان ثبت‌شده', formatDuration(stats.tracked_seconds || 0), `${stats.overdue_tasks || 0} مورد عقب‌افتاده`, '◴'],
    ]
    : [
      ['پروژه‌های فعال', stats.active_projects || 0, `از ${stats.total_projects || 0} پروژه`, '▣'],
      ['تسک‌های در جریان', stats.in_progress_tasks || 0, `${stats.todo_tasks || 0} مورد آماده شروع`, '◷'],
      ['در انتظار بازبینی', stats.review_tasks || 0, `${stats.overdue_tasks || 0} مورد عقب‌افتاده`, '◎'],
      ['زمان ثبت‌شده تیم', formatDuration(stats.tracked_seconds || 0), `${stats.done_tasks || 0} تسک تکمیل‌شده`, '◴'],
    ];

  return (
    <div className="stats-grid workspace-stats">
      {cards.map(([label, value, hint, icon]) => (
        <div className="stat-card" key={label}>
          <div className="stat-icon">{icon}</div>
          <div><span>{label}</span><strong dir={label.includes('زمان') ? 'ltr' : undefined}>{value}</strong><small>{hint}</small></div>
        </div>
      ))}
    </div>
  );
}

function RecentTasks({ tasks, title = 'آخرین تسک‌ها' }) {
  return (
    <section className="panel workspace-task-panel">
      <div className="panel-header"><div><h3>{title}</h3><p>آخرین موارد در محدوده دسترسی شما</p></div><Link className="text-link" to="/tasks">مشاهده همه ←</Link></div>
      {tasks.length ? (
        <div className="task-list compact">
          {tasks.map((task) => (
            <Link to={`/tasks?task=${task.id}`} className="task-row" key={task.id}>
              <div className="task-main"><strong>{task.title}</strong><span>{task.project_name} · {task.assignee_name || 'بدون مسئول'}</span></div>
              <div className="task-meta"><Badge value={task.status} /><Badge type="priority" value={task.priority} /><span>{formatDate(task.due_date)}</span></div>
            </Link>
          ))}
        </div>
      ) : <EmptyState title="تسکی برای نمایش نیست" text="در حال حاضر مورد تازه‌ای در دسترس شما قرار ندارد." />}
    </section>
  );
}

function AdminDashboard({ user, data }) {
  const stats = data.stats;
  const cards = [
    ['پروژه‌های فعال', stats.active_projects || 0, `از ${stats.total_projects || 0} پروژه`, '▣'],
    ['تسک‌های در جریان', stats.in_progress_tasks || 0, `${stats.review_tasks || 0} مورد در بازبینی`, '◷'],
    ['تسک‌های تکمیل‌شده', stats.done_tasks || 0, `${stats.total_tasks || 0} تسک کل`, '✓'],
    ['زمان ثبت‌شده', formatDuration(stats.tracked_seconds || 0), `${stats.overdue_tasks || 0} مورد عقب‌افتاده`, '◴'],
  ];

  return (
    <>
      <PageHeader title={`سلام ${user.full_name}`} subtitle="نمای کلی وضعیت پروژه‌ها، تسک‌ها و فعالیت امروز" />
      <div className="stats-grid">{cards.map(([label, value, hint, icon]) => <div className="stat-card" key={label}><div className="stat-icon">{icon}</div><div><span>{label}</span><strong dir={label === 'زمان ثبت‌شده' ? 'ltr' : undefined}>{value}</strong><small>{hint}</small></div></div>)}</div>

      <div className="admin-strip">
        <div><span>کاربران فعال</span><strong>{Number(data.admin.users.total_users || 0) - Number(data.admin.users.inactive_users || 0)}</strong></div>
        <div><span>مدیران پروژه</span><strong>{data.admin.users.managers || 0}</strong></div>
        <div><span>برنامه‌نویسان</span><strong>{data.admin.users.developers || 0}</strong></div>
        <div><span>تایمرهای فعال</span><strong>{data.admin.activeTimers.length}</strong></div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header"><div><h3>آخرین تسک‌ها</h3><p>فعالیت‌های اخیر در محدوده دسترسی شما</p></div></div>
          {data.recentTasks.length ? <div className="task-list compact">{data.recentTasks.map((task) => <div className="task-row" key={task.id}><div className="task-main"><strong>{task.title}</strong><span>{task.project_name} · {task.assignee_name || 'بدون مسئول'}</span></div><div className="task-meta"><Badge value={task.status} /><Badge type="priority" value={task.priority} /><span>{formatDate(task.due_date)}</span></div></div>)}</div> : <EmptyState />}
        </section>
        <section className="panel side-panel">
          <div className="panel-header"><div><h3>تایمرهای زنده</h3><p>نمای عملیاتی لحظه‌ای</p></div></div>
          {data.admin.activeTimers.length ? <div className="live-list">{data.admin.activeTimers.map((timer) => <div key={timer.id}><span className="pulse" /><div><strong>{timer.user_name}</strong><small>{timer.project_name} · {timer.task_title}</small></div><b dir="ltr">{formatDuration(timer.live_seconds)}</b></div>)}</div> : <EmptyState title="تایمر فعالی نیست" text="در حال حاضر هیچ کاربری تایمر روشن ندارد." />}
        </section>
      </div>
    </>
  );
}

function ManagerDashboard({ user, data }) {
  const stats = data.stats;
  const progress = stats.total_tasks ? Math.round((Number(stats.done_tasks || 0) / Number(stats.total_tasks)) * 100) : 0;

  return (
    <>
      <section className="workspace-hero manager-hero">
        <div>
          <span className="workspace-kicker">فضای مدیریت پروژه</span>
          <h1>{user.full_name}، امروز چه چیزی باید جلو برود؟</h1>
          <p>پروژه‌ها، تسک‌های تیم و موارد در انتظار بازبینی را از یک فضای کاری واحد مدیریت کنید.</p>
          <div className="workspace-hero-actions"><Link className="button button-primary" to="/tasks">مدیریت تسک‌ها</Link><Link className="button button-secondary" to="/reviews">مشاهده بازبینی‌ها</Link></div>
        </div>
        <div className="workspace-hero-summary"><span>پیشرفت کل پروژه‌ها</span><strong>{progress}%</strong><div><i style={{ width: `${progress}%` }} /></div><small>{stats.done_tasks || 0} تسک از {stats.total_tasks || 0} تسک تکمیل شده است.</small></div>
      </section>

      <StatCards stats={stats} role="project_manager" />

      <div className="workspace-dashboard-grid">
        <RecentTasks tasks={data.recentTasks} title="جریان کاری اخیر تیم" />
        <aside className="panel workspace-quick-panel">
          <div className="panel-header"><div><h3>دسترسی سریع</h3><p>میان بخش‌های مدیریتی جابه‌جا شوید</p></div></div>
          <div className="workspace-shortcuts">
            <Link to="/projects"><span>▣</span><div><strong>پروژه‌های من</strong><small>مشاهده وضعیت و اعضای پروژه‌ها</small></div></Link>
            <Link to="/reviews"><span>◎</span><div><strong>صف بازبینی</strong><small>{stats.review_tasks || 0} تسک منتظر تصمیم شماست</small></div></Link>
            <Link to="/time-logs"><span>◷</span><div><strong>زمان پروژه‌ها</strong><small>بررسی زمان ثبت‌شده اعضای تیم</small></div></Link>
            <Link to="/reports"><span>▤</span><div><strong>گزارش‌های تیم</strong><small>گزارش روزانه و موانع اجرایی</small></div></Link>
          </div>
        </aside>
      </div>
    </>
  );
}

function DeveloperDashboard({ user, data, activeTimer, elapsed }) {
  const stats = data.stats;
  const progress = stats.total_tasks ? Math.round((Number(stats.done_tasks || 0) / Number(stats.total_tasks)) * 100) : 0;

  return (
    <>
      <section className="workspace-hero developer-hero">
        <div>
          <span className="workspace-kicker">میز کار امروز</span>
          <h1>سلام {user.full_name}</h1>
          <p>{activeTimer ? `در حال کار روی «${activeTimer.task_title}» هستید.` : 'تسک بعدی را انتخاب کنید، تایمر را روشن کنید و پیشرفت امروز را ثبت کنید.'}</p>
          <div className="workspace-hero-actions"><Link className="button button-primary" to="/tasks">{activeTimer ? 'بازکردن تسک فعال' : 'مشاهده تسک‌های من'}</Link><Link className="button button-secondary" to="/reports">ثبت گزارش روزانه</Link></div>
        </div>
        <div className={`developer-focus-card ${activeTimer ? 'is-active' : ''}`}>
          <span>{activeTimer ? 'تایمر فعال' : 'وضعیت امروز'}</span>
          <strong dir={activeTimer ? 'ltr' : undefined}>{activeTimer ? formatDuration(elapsed) : `${stats.in_progress_tasks || 0} تسک فعال`}</strong>
          <small>{activeTimer ? activeTimer.project_name : `${stats.overdue_tasks || 0} تسک عقب‌افتاده و ${stats.review_tasks || 0} تسک در بازبینی`}</small>
        </div>
      </section>

      <StatCards stats={stats} role="developer" />

      <div className="workspace-dashboard-grid">
        <RecentTasks tasks={data.recentTasks} title="اولویت‌های من" />
        <aside className="panel workspace-quick-panel">
          <div className="panel-header"><div><h3>نمای شخصی</h3><p>وضعیت کار و دسترسی‌های روزانه</p></div></div>
          <div className="personal-progress"><div className="ring"><strong>{progress}%</strong><span>پیشرفت</span></div><p>از مجموع {stats.total_tasks || 0} تسک واگذارشده، {stats.done_tasks || 0} مورد تکمیل شده است.</p></div>
          <div className="workspace-shortcuts compact-shortcuts">
            <Link to="/projects"><span>▣</span><div><strong>پروژه‌های من</strong><small>مشاهده پروژه‌هایی که عضو آن‌ها هستید</small></div></Link>
            <Link to="/time-logs"><span>◷</span><div><strong>زمان‌های من</strong><small>مرور زمان ثبت‌شده به تفکیک پروژه</small></div></Link>
            <Link to="/profile"><span>♙</span><div><strong>پنل کاربری</strong><small>اطلاعات حساب و تغییر رمز عبور</small></div></Link>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const outlet = useOutletContext() || {};
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/dashboard').then(({ data: response }) => setData(response)).catch((e) => setError(getErrorMessage(e))); }, []);
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <div className="screen-center small"><div className="spinner" /></div>;

  if (user.role === 'admin') return <AdminDashboard user={user} data={data} />;
  if (user.role === 'project_manager') return <ManagerDashboard user={user} data={data} />;
  return <DeveloperDashboard user={user} data={data} activeTimer={outlet.activeTimer} elapsed={outlet.elapsed || 0} />;
}
