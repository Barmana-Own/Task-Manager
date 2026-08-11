import { useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import ProjectPicker from '../components/ProjectPicker.jsx';
import { EmptyState, formatDate, formatDuration, PageHeader, Toast } from '../components/UI.jsx';

export default function TimeLogsPage() {
  const [logs, setLogs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [filters, setFilters] = useState({ projectId: '', taskId: '', dateFrom: '', dateTo: '' });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === String(filters.projectId)),
    [projects, filters.projectId],
  );

  const load = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
      const [projectRes, logRes, taskRes] = await Promise.all([
        api.get('/projects'),
        filters.projectId ? api.get(`/timers/logs?${query}`) : Promise.resolve({ data: { logs: [] } }),
        filters.projectId ? api.get(`/tasks?projectId=${filters.projectId}`) : Promise.resolve({ data: { tasks: [] } }),
      ]);
      setProjects(projectRes.data.projects);
      setLogs(logRes.data.logs);
      setTasks(taskRes.data.tasks);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters.projectId, filters.taskId, filters.dateFrom, filters.dateTo]);

  const chooseProject = (projectId) => {
    setFilters({ projectId, taskId: '', dateFrom: '', dateTo: '' });
    setLogs([]);
    setTasks([]);
  };

  const totalSeconds = useMemo(() => logs.reduce((sum, log) => sum + Number(log.effective_seconds || 0), 0), [logs]);
  const perUser = useMemo(() => {
    const map = new Map();
    for (const log of logs) map.set(log.user_name, (map.get(log.user_name) || 0) + Number(log.effective_seconds || 0));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const exportCsv = () => {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [
      ['کاربر', 'پروژه', 'تسک', 'شروع', 'پایان', 'مدت ثانیه', 'یادداشت'],
      ...logs.map((log) => [log.user_name, log.project_name, log.task_title, log.started_at, log.ended_at || '', log.effective_seconds || 0, log.note || '']),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `time-logs-${selectedProject?.code || 'project'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="ریز زمان‌های ثبت‌شده"
        subtitle={selectedProject ? `مجموع زمان پروژه «${selectedProject.name}»: ${formatDuration(totalSeconds)}` : 'برای مشاهده زمان‌ها، ابتدا پروژه را انتخاب کنید.'}
        action={logs.length ? <button className="button button-ghost" onClick={exportCsv}>خروجی CSV همین پروژه</button> : null}
      />

      <ProjectPicker projects={projects} value={filters.projectId} onChange={chooseProject} title="پروژه فعال برای گزارش زمان" />

      {filters.projectId && (
        <div className="filters-bar project-time-filters">
          <select value={filters.taskId} onChange={(event) => setFilters({ ...filters, taskId: event.target.value })}>
            <option value="">همه تسک‌های این پروژه</option>
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
          <label className="compact-date-filter"><span>از تاریخ</span><JalaliDatePicker value={filters.dateFrom} onChange={(dateFrom) => setFilters({ ...filters, dateFrom })} max={filters.dateTo || undefined} /></label>
          <label className="compact-date-filter"><span>تا تاریخ</span><JalaliDatePicker value={filters.dateTo} onChange={(dateTo) => setFilters({ ...filters, dateTo })} min={filters.dateFrom || undefined} /></label>
          <button className="button button-small button-ghost" onClick={() => setFilters({ ...filters, taskId: '', dateFrom: '', dateTo: '' })}>پاک‌کردن فیلترهای پروژه</button>
          <span>{logs.length} بازه</span>
        </div>
      )}

      {filters.projectId && perUser.length > 0 && <div className="time-summary">{perUser.slice(0, 6).map(([name, seconds]) => <div key={name}><span>{name}</span><strong dir="ltr">{formatDuration(seconds)}</strong></div>)}</div>}

      <section className="panel table-panel">
        {!filters.projectId ? (
          <EmptyState title="پروژه‌ای انتخاب نشده" text="هر پروژه گزارش زمان مستقل دارد. یک پروژه را انتخاب کنید تا فقط بازه‌های همان پروژه نمایش داده شوند." />
        ) : loading ? <div className="screen-center small"><div className="spinner" /></div> : logs.length ? (
          <div className="table-wrap"><table><thead><tr><th>کاربر</th><th>تسک پروژه</th><th>شروع شمسی</th><th>پایان شمسی</th><th>مدت</th><th>یادداشت بازه</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td><div className="user-cell"><div className="avatar small">{log.user_name.slice(0, 1)}</div><div><strong>{log.user_name}</strong></div></div></td><td><strong>{log.task_title}</strong><div className="cell-hint">{log.project_name}</div></td><td>{formatDate(log.started_at, true)}</td><td>{log.ended_at ? formatDate(log.ended_at, true) : <span className="status-dot-label active"><i />فعال</span>}</td><td dir="ltr">{formatDuration(log.effective_seconds)}</td><td className="note-cell">{log.note || '—'}</td></tr>)}</tbody></table></div>
        ) : <EmptyState title="برای این پروژه زمانی ثبت نشده" text="با شروع و توقف تایمر روی تسک‌های همین پروژه، بازه‌های کاری اینجا نمایش داده می‌شوند." />}
      </section>
      <Toast {...toast} onClose={() => setToast(null)} />
    </>
  );
}
