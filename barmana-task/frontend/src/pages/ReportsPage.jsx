import { useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import Modal from '../components/Modal.jsx';
import { EmptyState, formatDate, formatDuration, PageHeader, RoleLabel, Toast } from '../components/UI.jsx';

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const initialForm = { projectId: '', reportDate: today, summary: '', blockers: '', nextPlan: '' };
const initialProjectReportForm = {
  projectId: '',
  reportDate: today,
  delayNote: '',
  lossAmount: '',
  lossUnit: 'تومان',
  lossNote: '',
  managerNote: '',
};

function ProgressMetric({ label, value, hint, tone = '' }) {
  return (
    <div className={`project-report-metric ${tone ? `is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const canSeeProjectProgress = ['admin', 'project_manager'].includes(user.role);
  const [view, setView] = useState('daily');
  const [reports, setReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ projectId: '', date: '' });
  const [form, setForm] = useState(initialForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [projectReport, setProjectReport] = useState(null);
  const [projectReportForm, setProjectReportForm] = useState(initialProjectReportForm);
  const [projectReportLoading, setProjectReportLoading] = useState(false);
  const [projectReportSaving, setProjectReportSaving] = useState(false);

  const load = async () => {
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
      const [reportRes, projectRes] = await Promise.all([api.get(`/reports${query ? `?${query}` : ''}`), api.get('/projects')]);
      setReports(reportRes.data.reports);
      setProjects(projectRes.data.projects);
      if (canSeeProjectProgress && !projectReportForm.projectId && projectRes.data.projects[0]?.id) {
        setProjectReportForm((current) => ({ ...current, projectId: String(projectRes.data.projects[0].id) }));
      }
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [filters.projectId, filters.date]);

  const loadProjectReport = async (projectId = projectReportForm.projectId, reportDate = projectReportForm.reportDate) => {
    if (!projectId || !canSeeProjectProgress) {
      setProjectReport(null);
      return;
    }
    setProjectReportLoading(true);
    try {
      const { data } = await api.get('/reports/project-progress', { params: { projectId, date: reportDate } });
      setProjectReport(data.report);
      const saved = data.report.saved || {};
      setProjectReportForm((current) => ({
        ...current,
        projectId: String(projectId),
        reportDate,
        delayNote: saved.delayNote || '',
        lossAmount: saved.lossAmount || '',
        lossUnit: saved.lossUnit || 'تومان',
        lossNote: saved.lossNote || '',
        managerNote: saved.managerNote || '',
      }));
    } catch (error) {
      setProjectReport(null);
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setProjectReportLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'project' && canSeeProjectProgress && projectReportForm.projectId) {
      loadProjectReport(projectReportForm.projectId, projectReportForm.reportDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const openNew = () => {
    setForm({ ...initialForm, projectId: projects[0]?.id ? String(projects[0].id) : '' });
    setShowForm(true);
  };

  const openEdit = (report) => {
    setForm({
      projectId: String(report.project_id), reportDate: report.report_date, summary: report.summary,
      blockers: report.blockers || '', nextPlan: report.next_plan || '',
    });
    setShowForm(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/reports', { ...form, projectId: Number(form.projectId) });
      setToast({ message: data.message });
      setShowForm(false);
      setForm(initialForm);
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const saveProjectProgress = async (event) => {
    event.preventDefault();
    if (!projectReportForm.projectId) return;
    setProjectReportSaving(true);
    try {
      const { data } = await api.post('/reports/project-progress', {
        ...projectReportForm,
        projectId: Number(projectReportForm.projectId),
        lossAmount: projectReportForm.lossAmount === '' ? null : Number(projectReportForm.lossAmount),
      });
      setToast({ message: data.message });
      setProjectReport(data.report);
      const saved = data.report.saved || {};
      setProjectReportForm((current) => ({
        ...current,
        delayNote: saved.delayNote || current.delayNote,
        lossAmount: saved.lossAmount ?? current.lossAmount,
        lossUnit: saved.lossUnit || current.lossUnit,
        lossNote: saved.lossNote || current.lossNote,
        managerNote: saved.managerNote || current.managerNote,
      }));
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setProjectReportSaving(false);
    }
  };

  const downloadProjectReport = async () => {
    if (!projectReportForm.projectId) return;
    try {
      const response = await api.get('/reports/project-progress/download', {
        params: { projectId: projectReportForm.projectId, date: projectReportForm.reportDate },
        responseType: 'blob',
      });
      const disposition = response.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const fallback = `project-report-${projectReportForm.reportDate}.txt`;
      const filename = match?.[1] || fallback;
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const summary = useMemo(() => {
    const total = reports.length;
    const blocked = reports.filter((report) => report.blockers?.trim()).length;
    const contributors = new Set(reports.map((report) => report.user_id)).size;
    return { total, blocked, contributors };
  }, [reports]);

  const varianceTone = Number(projectReport?.varianceProgress || 0) < 0 ? 'danger' : 'success';

  return (
    <>
      <PageHeader
        title="گزارش‌ها"
        subtitle="گزارش روزانه کارکنان و گزارش مدیریتی پیشرفت واقعی پروژه"
        action={view === 'daily' ? <button className="button button-primary" onClick={openNew}>+ ثبت گزارش</button> : null}
      />

      {canSeeProjectProgress && (
        <div className="reports-view-tabs">
          <button type="button" className={view === 'daily' ? 'is-active' : ''} onClick={() => setView('daily')}>گزارش روزانه کارکنان</button>
          <button type="button" className={view === 'project' ? 'is-active' : ''} onClick={() => setView('project')}>پیشرفت پایان روز پروژه</button>
        </div>
      )}

      {view === 'daily' ? (
        <>
          <div className="report-summary"><div><span>گزارش‌ها</span><strong>{summary.total}</strong></div><div><span>دارای مانع</span><strong>{summary.blocked}</strong></div><div><span>گزارش‌دهندگان</span><strong>{summary.contributors}</strong></div></div>
          <div className="filters-bar"><select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">همه پروژه‌ها</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><label className="compact-date-filter"><span>تاریخ شمسی</span><JalaliDatePicker value={filters.date} onChange={(date) => setFilters({ ...filters, date })} max={today} /></label><button type="button" className="button button-small button-ghost" onClick={() => setFilters({ projectId: '', date: '' })}>پاک‌کردن فیلتر</button><span>{reports.length} گزارش</span></div>

          {loading ? <div className="screen-center small"><div className="spinner" /></div> : reports.length ? (
            <div className="reports-list">{reports.map((report) => (
              <article className="report-card" key={report.id}>
                <div className="report-head"><div className="avatar">{report.user_name.slice(0, 1)}</div><div><strong>{report.user_name}</strong><span><RoleLabel role={report.user_role} /> · {report.project_name}</span></div><time>{formatDate(report.report_date)}</time>{Number(report.user_id) === Number(user.id) && <button className="button button-small button-ghost" onClick={() => openEdit(report)}>ویرایش</button>}</div>
                <div className="report-section"><strong>خلاصه فعالیت</strong><p>{report.summary}</p></div>
                <div className="report-columns"><div><strong>موانع و چالش‌ها</strong><p>{report.blockers || 'موردی ثبت نشده است.'}</p></div><div><strong>برنامه بعدی</strong><p>{report.next_plan || 'موردی ثبت نشده است.'}</p></div></div>
              </article>
            ))}</div>
          ) : <EmptyState title="گزارشی پیدا نشد" text="گزارش روزانه باعث شفافیت پیشرفت و موانع تیم می‌شود." />}
        </>
      ) : (
        <div className="project-progress-report-page">
          <div className="project-progress-report-toolbar">
            <label><span>پروژه</span><select value={projectReportForm.projectId} onChange={(event) => {
              const projectId = event.target.value;
              setProjectReportForm((current) => ({ ...current, projectId }));
              loadProjectReport(projectId, projectReportForm.reportDate);
            }}><option value="">انتخاب پروژه</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.code}</option>)}</select></label>
            <label><span>تاریخ گزارش</span><JalaliDatePicker value={projectReportForm.reportDate} onChange={(reportDate) => {
              setProjectReportForm((current) => ({ ...current, reportDate }));
              if (projectReportForm.projectId) loadProjectReport(projectReportForm.projectId, reportDate);
            }} max={today} /></label>
            <button type="button" className="button button-ghost" disabled={!projectReportForm.projectId || projectReportLoading} onClick={() => loadProjectReport()}>{projectReportLoading ? 'در حال محاسبه…' : 'محاسبه مجدد'}</button>
          </div>

          {!projectReportForm.projectId ? <EmptyState title="پروژه را انتخاب کنید" text="برای مشاهده پیشرفت واقعی، برنامه‌ای، تاخیر و گزارش پایان روز یک پروژه را انتخاب کنید." /> : projectReportLoading ? <div className="screen-center small"><div className="spinner" /></div> : projectReport ? (
            <>
              <div className="project-progress-report-hero">
                <div><span>گزارش پایان روز</span><h2>{projectReport.project.name}</h2><p>{projectReport.project.code} · مدیر: {projectReport.project.managerName || '—'} · {formatDate(projectReport.reportDate)}</p></div>
                <div className={`project-progress-variance is-${varianceTone}`}><small>انحراف از برنامه</small><strong>{Number(projectReport.varianceProgress) > 0 ? '+' : ''}{projectReport.varianceProgress}%</strong><span>{Number(projectReport.varianceProgress) < 0 ? 'عقب‌تر از برنامه' : 'مطابق یا جلوتر از برنامه'}</span></div>
              </div>

              <div className="project-report-metrics">
                <ProgressMetric label="پیشرفت برنامه‌ای" value={`${projectReport.plannedProgress}%`} hint={projectReport.plannedMethod === 'project_schedule' ? 'بر اساس تاریخ شروع و هدف' : projectReport.plannedMethod === 'task_due_dates' ? 'بر اساس موعد تسک‌ها' : 'برنامه زمانی کافی ثبت نشده'} />
                <ProgressMetric label="پیشرفت واقعی" value={`${projectReport.actualProgress}%`} hint="بر اساس تکمیل تسک و چک‌لیست" tone={varianceTone} />
                <ProgressMetric label="تسک‌های تکمیل‌شده" value={`${projectReport.doneTasks} / ${projectReport.totalTasks}`} />
                <ProgressMetric label="تسک‌های در جریان" value={projectReport.inProgressTasks} />
                <ProgressMetric label="عقب‌افتاده باز" value={projectReport.overdueTasks} tone={projectReport.overdueTasks ? 'danger' : ''} />
                <ProgressMetric label="مجموع روزهای تاخیر" value={`${projectReport.delayDays} روز`} tone={projectReport.delayDays ? 'danger' : ''} />
                <ProgressMetric label="زمان ثبت‌شده امروز" value={formatDuration(projectReport.trackedSeconds)} />
              </div>

              <div className="project-progress-bars">
                <div><span><b>پیشرفت برنامه‌ای</b><strong>{projectReport.plannedProgress}%</strong></span><div><i style={{ width: `${Math.min(100, Number(projectReport.plannedProgress || 0))}%` }} /></div></div>
                <div className="actual"><span><b>پیشرفت واقعی</b><strong>{projectReport.actualProgress}%</strong></span><div><i style={{ width: `${Math.min(100, Number(projectReport.actualProgress || 0))}%` }} /></div></div>
              </div>

              <div className="project-delay-panel">
                <div className="project-report-section-head"><div><strong>تاخیرات پروژه</strong><span>تسک‌های باز عقب‌افتاده و تسک‌هایی که با تاخیر تکمیل شده‌اند</span></div><b>{projectReport.delayDays} روز تاخیر</b></div>
                {projectReport.overdueList?.length || projectReport.completedLateList?.length ? (
                  <div className="project-delay-list">
                    {projectReport.overdueList?.map((task) => <div key={`open-${task.id}`}><span className="delay-state is-open">باز</span><strong>#{String(task.sequenceNo).padStart(2, '0')} {task.title}</strong><small>{task.sectionTitle || 'بدون بخش'} · {task.assigneeName}</small><b>{task.delayDays} روز</b></div>)}
                    {projectReport.completedLateList?.map((task) => <div key={`done-${task.id}`}><span className="delay-state is-done">تکمیل</span><strong>#{String(task.sequenceNo).padStart(2, '0')} {task.title}</strong><small>{task.assigneeName} · تکمیل {formatDate(task.completedDate)}</small><b>{task.delayDays} روز</b></div>)}
                  </div>
                ) : <div className="project-report-empty-line">برای این تاریخ تاخیری ثبت نشده است.</div>}
              </div>

              <form className="project-progress-notes" onSubmit={saveProjectProgress}>
                <div className="project-report-section-head"><div><strong>جمع‌بندی مدیریتی پایان روز</strong><span>این اطلاعات داخل فایل Notepad گزارش پروژه ذخیره می‌شود.</span></div>{projectReport.saved?.generatedAt && <small>آخرین تولید: {formatDate(projectReport.saved.generatedAt, true)}</small>}</div>
                <label className="full"><span>شرح تاخیرات و علت‌ها</span><textarea rows="3" value={projectReportForm.delayNote} onChange={(event) => setProjectReportForm({ ...projectReportForm, delayNote: event.target.value })} placeholder="علت تاخیر، وابستگی، مانع یا تصمیم لازم را بنویسید…" /></label>
                <label><span>برآورد ضرر و زیان</span><input type="number" min="0" step="0.01" value={projectReportForm.lossAmount} onChange={(event) => setProjectReportForm({ ...projectReportForm, lossAmount: event.target.value })} placeholder="مثلاً 25000000" /></label>
                <label><span>واحد مبلغ</span><input maxLength="20" value={projectReportForm.lossUnit} onChange={(event) => setProjectReportForm({ ...projectReportForm, lossUnit: event.target.value })} placeholder="تومان" /></label>
                <label className="full"><span>شرح ضرر و زیان / اثر تاخیر</span><textarea rows="3" value={projectReportForm.lossNote} onChange={(event) => setProjectReportForm({ ...projectReportForm, lossNote: event.target.value })} placeholder="اثر مالی، زمانی، قراردادی یا عملیاتی تاخیر را بنویسید…" /></label>
                <label className="full"><span>جمع‌بندی مدیر پروژه</span><textarea rows="4" value={projectReportForm.managerNote} onChange={(event) => setProjectReportForm({ ...projectReportForm, managerNote: event.target.value })} placeholder="امروز پروژه چه تغییری کرد، تصمیم فردا چیست و چه چیزی باید پیگیری شود؟" /></label>
                <div className="project-report-actions full">
                  <button type="button" className="button button-ghost" onClick={downloadProjectReport}>دانلود فایل TXT</button>
                  <button className="button button-primary" disabled={projectReportSaving}>{projectReportSaving ? 'در حال تولید…' : 'ذخیره و تولید گزارش پایان روز'}</button>
                </div>
              </form>

              <div className="project-report-team-summary">
                <div className="project-report-section-head"><div><strong>فعالیت ثبت‌شده اعضا</strong><span>خلاصه‌ای که وارد فایل پایان روز می‌شود</span></div><b>{projectReport.employeeReports?.length || projectReport.taskReports?.length || 0} گزارش</b></div>
                {projectReport.employeeReports?.length ? projectReport.employeeReports.map((report) => <article key={report.user_id}><strong>{report.user_name}</strong><p>{report.summary}</p>{report.blockers && <small>مانع: {report.blockers}</small>}</article>) : projectReport.taskReports?.length ? projectReport.taskReports.map((report) => <article key={`${report.task_id}-${report.user_name}`}><strong>{report.user_name} · #{String(report.sequence_no).padStart(2, '0')} {report.task_title}</strong><p>{report.body}</p></article>) : <div className="project-report-empty-line">برای این تاریخ گزارش فعالیتی ثبت نشده است.</div>}
              </div>
            </>
          ) : <EmptyState title="گزارش قابل محاسبه نیست" text="پروژه یا تاریخ انتخاب‌شده را بررسی کنید." />}
        </div>
      )}

      {showForm && <Modal title="ثبت یا ویرایش گزارش روزانه" wide onClose={() => setShowForm(false)}><form className="form-grid" onSubmit={save}><label>پروژه<select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">انتخاب پروژه</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>تاریخ شمسی<JalaliDatePicker required value={form.reportDate} onChange={(reportDate) => setForm({ ...form, reportDate })} max={today} /></label><label className="full">خلاصه فعالیت<textarea required minLength="5" rows="4" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="چه کارهایی انجام شد؟" /></label><label>موانع و چالش‌ها<textarea rows="4" value={form.blockers} onChange={(event) => setForm({ ...form, blockers: event.target.value })} /></label><label>برنامه گام بعد<textarea rows="4" value={form.nextPlan} onChange={(event) => setForm({ ...form, nextPlan: event.target.value })} /></label><div className="modal-actions full"><button type="button" className="button button-ghost" onClick={() => setShowForm(false)}>انصراف</button><button className="button button-primary" disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره گزارش'}</button></div></form></Modal>}
      <Toast {...toast} onClose={() => setToast(null)} />
    </>
  );
}
