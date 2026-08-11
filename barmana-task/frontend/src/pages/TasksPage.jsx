import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import Modal from '../components/Modal.jsx';
import ProjectPicker from '../components/ProjectPicker.jsx';
import { Badge, EmptyState, formatDate, formatDuration, PageHeader, RoleLabel, Toast } from '../components/UI.jsx';
import {
  MANAGER_REVIEW_CRITERIA,
  REVIEW_CRITERIA,
  defaultManagerReviewRatings,
  defaultReviewRatings,
  getAverageRating,
} from '../constants/reviewCriteria.js';

const emptyChecklistItem = () => ({ id: null, title: '', description: '' });
const initialForm = {
  projectId: '',
  sectionId: '',
  title: '',
  description: '',
  assigneeId: '',
  priority: 'medium',
  dueDate: '',
  estimatedMinutes: '',
  checklistItems: [],
};

function taskNumber(task) {
  return String(Number(task?.sequence_no || task?.id || 0)).padStart(2, '0');
}

function checklistProgress(task) {
  const total = Number(task?.checklist_total || 0);
  const completed = Number(task?.checklist_completed || 0);
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}


export default function TasksPage({ initialStatus = '', reviewMode = false }) {
  const { user } = useAuth();
  const outlet = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [sections, setSections] = useState([]);
  const [filters, setFilters] = useState({
    q: '',
    projectId: searchParams.get('project') || '',
    sectionId: '',
    status: initialStatus,
    priority: '',
    due: '',
  });
  const [form, setForm] = useState(initialForm);
  const [formMode, setFormMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [dailyReport, setDailyReport] = useState('');
  const [dailySaving, setDailySaving] = useState(false);
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [completionLink, setCompletionLink] = useState('');
  const [ratings, setRatings] = useState(() => defaultReviewRatings());
  const [managerRatings, setManagerRatings] = useState(() => defaultManagerReviewRatings());
  const [activeTimer, setActiveTimer] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === String(filters.projectId)),
    [projects, filters.projectId],
  );
  const canManageTasks = ['admin', 'project_manager'].includes(user.role) || Boolean(user.task_assignment_access);
  const canCreateTask = canManageTasks && selectedProject && !['completed', 'archived'].includes(selectedProject.status);
  const formAssignees = useMemo(() => {
    const selectedSection = sections.find((section) => String(section.id) === String(form.sectionId));
    const sectionTeam = selectedSection?.members || [];
    const manager = members.find((member) => member.is_project_manager);
    const base = sectionTeam.length
      ? [...sectionTeam]
      : members.filter((member) => member.role === 'developer' && !member.is_project_manager);
    const list = [...base];
    if (manager && !list.some((member) => Number(member.id) === Number(manager.id))) list.unshift(manager);
    return list;
  }, [sections, members, form.sectionId]);
  const reviewAverage = useMemo(() => getAverageRating(ratings), [ratings]);
  const managerReviewAverage = useMemo(
    () => getAverageRating(managerRatings, MANAGER_REVIEW_CRITERIA),
    [managerRatings],
  );

  const load = async () => {
    setLoading(true);
    try {
      const taskQuery = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => value),
      ).toString();
      const [projectRes, taskRes, timerRes, sectionRes] = await Promise.all([
        api.get('/projects'),
        filters.projectId ? api.get(`/tasks?${taskQuery}`) : Promise.resolve({ data: { tasks: [] } }),
        ['developer', 'project_manager'].includes(user.role) ? api.get('/timers/active') : Promise.resolve(null),
        filters.projectId ? api.get(`/projects/${filters.projectId}`) : Promise.resolve({ data: { sections: [] } }),
      ]);
      setProjects(projectRes.data.projects);
      setTasks(taskRes.data.tasks);
      setSections(sectionRes.data.sections || []);
      if (timerRes) {
        const timer = timerRes.data.timers[0] || null;
        setTick(0);
        setActiveTimer(timer);
        outlet?.setActiveTimer?.(timer);
      }
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Search text is submitted manually; dropdowns reload immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.projectId, filters.sectionId, filters.status, filters.priority, filters.due]);

  useEffect(() => {
    if (!activeTimer) return undefined;
    const interval = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  useEffect(() => {
    const taskId = searchParams.get('task');
    if (taskId) openDetail(Number(taskId), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeElapsed = useMemo(
    () => (activeTimer ? Number(activeTimer.live_seconds || 0) + tick : 0),
    [activeTimer, tick],
  );
  const getTrackedSeconds = (task) => Number(task?.tracked_seconds || 0)
    + (Number(activeTimer?.task_id) === Number(task?.id) ? activeElapsed : 0);
  const detailTrackedSeconds = detail?.task ? getTrackedSeconds(detail.task) : 0;
  const detailTimeLogs = useMemo(() => {
    if (!detail) return [];
    const logs = detail.timeLogs ? [...detail.timeLogs] : [];
    const isCurrentTaskActive = Number(activeTimer?.task_id) === Number(detail.task?.id);
    const hasOpenLog = logs.some((item) => item.ended_at === null);
    if (isCurrentTaskActive && !hasOpenLog) {
      logs.unshift({
        id: `live-${activeTimer.id}`,
        user_name: activeTimer.user_name,
        started_at: activeTimer.started_at,
        ended_at: null,
        effective_seconds: activeElapsed,
        note: 'در حال ثبت زنده',
      });
    }
    return logs;
  }, [detail, activeTimer, activeElapsed]);

  const loadMembers = async (projectId) => {
    if (!projectId) {
      setMembers([]);
      return [];
    }
    const { data } = await api.get(`/projects/${projectId}`);
    const assignees = [...(data.members || [])];
    if (data.project?.manager_id && !assignees.some((member) => Number(member.id) === Number(data.project.manager_id))) {
      assignees.unshift({
        id: data.project.manager_id,
        full_name: data.project.manager_name || 'مدیر پروژه',
        is_project_manager: true,
      });
    }
    setMembers(assignees);
    setSections(data.sections || []);
    return data;
  };

  const chooseProject = (projectId) => {
    setFilters({ q: '', projectId, sectionId: '', status: initialStatus, priority: '', due: '' });
    setTasks([]);
    setMembers([]);
    setSections([]);
    setSearchParams(projectId ? { project: projectId } : {}, { replace: true });
  };

  const openCreate = async (preferredSectionId = '') => {
    if (!filters.projectId) {
      setToast({ message: 'ابتدا پروژه را انتخاب کنید.', tone: 'danger' });
      return;
    }
    try {
      const projectData = await loadMembers(filters.projectId);
      const resolvedSectionId = preferredSectionId || filters.sectionId || '';
      setEditingId(null);
      setForm({
        ...initialForm,
        projectId: String(filters.projectId),
        sectionId: resolvedSectionId ? String(resolvedSectionId) : '',
        assigneeId: '',
        checklistItems: [],
      });
      setFormMode('create');
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const openEdit = async (task) => {
    try {
      const [, detailRes] = await Promise.all([
        loadMembers(task.project_id),
        api.get(`/tasks/${task.id}`),
      ]);
      const fullTask = detailRes.data.task;
      setEditingId(task.id);
      setForm({
        projectId: String(fullTask.project_id),
        sectionId: fullTask.section_id ? String(fullTask.section_id) : '',
        title: fullTask.title,
        description: fullTask.description || '',
        assigneeId: fullTask.assignee_id ? String(fullTask.assignee_id) : '',
        priority: fullTask.priority,
        dueDate: fullTask.due_date || '',
        estimatedMinutes: fullTask.estimated_minutes || '',
        checklistItems: detailRes.data.checklist.length
          ? detailRes.data.checklist.map((item) => ({ id: item.id, title: item.title, description: item.description || '' }))
          : [],
      });
      setDetailOpen(false);
      setFormMode('edit');
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const updateChecklistDraft = (index, field, value) => {
    setForm((current) => ({
      ...current,
      checklistItems: current.checklistItems.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }));
  };

  const addChecklistDraft = () => {
    setForm((current) => ({
      ...current,
      checklistItems: [...current.checklistItems, emptyChecklistItem()],
    }));
  };

  const removeChecklistDraft = (index) => {
    setForm((current) => {
      const next = current.checklistItems.filter((_, itemIndex) => itemIndex !== index);
      return { ...current, checklistItems: next };
    });
  };

  const saveTask = async (event) => {
    event.preventDefault();
    if (!form.projectId) {
      setToast({ message: 'پروژه تسک مشخص نیست.', tone: 'danger' });
      return;
    }
    setSaving(true);
    try {
      const checklistItems = form.checklistItems
        .map((item) => ({ ...(item.id ? { id: Number(item.id) } : {}), title: item.title.trim(), description: item.description?.trim() || null }))
        .filter((item) => item.title);
      const payload = {
        sectionId: form.sectionId ? Number(form.sectionId) : null,
        title: form.title,
        description: form.description || null,
        assigneeId: form.assigneeId ? Number(form.assigneeId) : null,
        priority: form.priority,
        dueDate: form.dueDate || null,
        estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
        checklistItems,
      };
      const response = formMode === 'create'
        ? await api.post('/tasks', { ...payload, projectId: Number(form.projectId) })
        : await api.patch(`/tasks/${editingId}`, payload);
      setToast({ message: response.data.message });
      setFormMode(null);
      setForm(initialForm);
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  async function openDetail(taskId, fromLink = false) {
    try {
      setDetail(null);
      setDailyReport('');
      setDetailOpen(true);
      const { data } = await api.get(`/tasks/${taskId}`);
      setDetail(data);
      const todayReport = data.dailyReports?.find((item) => (
        Number(item.user_id) === Number(user.id) && Boolean(item.is_today)
      ));
      setDailyReport(todayReport?.body || '');
      if (String(filters.projectId) !== String(data.task.project_id)) {
        setFilters((current) => ({ ...current, projectId: String(data.task.project_id) }));
      }
      if (fromLink) setSearchParams({ project: String(data.task.project_id) }, { replace: true });
    } catch (error) {
      setDetailOpen(false);
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  }

  const refreshDetail = async () => {
    if (!detail?.task?.id) return;
    const { data } = await api.get(`/tasks/${detail.task.id}`);
    setDetail(data);
    const todayReport = data.dailyReports?.find((item) => (
      Number(item.user_id) === Number(user.id) && Boolean(item.is_today)
    ));
    setDailyReport(todayReport?.body || '');
  };

  const addComment = async (event) => {
    event.preventDefault();
    if (!comment.trim()) return;
    try {
      await api.post(`/tasks/${detail.task.id}/comments`, { body: comment.trim() });
      setComment('');
      await refreshDetail();
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const deleteComment = async (commentId) => {
    try {
      await api.delete(`/tasks/${detail.task.id}/comments/${commentId}`);
      await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const deleteTask = async (task) => {
    const warning = `تسک شماره ${taskNumber(task)} «${task.title}» حذف شود؟\n\nزمان‌ها، گزارش‌های روی تسک، پیام‌ها و ارزیابی‌های وابسته به این تسک هم حذف می‌شوند.`;
    if (!window.confirm(warning)) return;
    try {
      const { data } = await api.delete(`/tasks/${task.id}`);
      setToast({ message: data.message });
      if (Number(detail?.task?.id) === Number(task.id)) setDetailOpen(false);
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const completeManagerTask = async (task) => {
    if (!window.confirm(`تسک شخصی «${task.title}» به‌عنوان انجام‌شده ثبت شود؟`)) return;
    try {
      const { data } = await api.post(`/tasks/${task.id}/complete-self`, {});
      setToast({ message: data.message });
      await load();
      if (detailOpen && Number(detail?.task?.id) === Number(task.id)) await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const toggleChecklist = async (item) => {
    try {
      const { data } = await api.patch(`/tasks/${detail.task.id}/checklist/${item.id}`, {
        isCompleted: !Boolean(item.is_completed),
      });
      setToast({ message: data.message });
      await Promise.all([refreshDetail(), load()]);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const saveDailyReport = async (event) => {
    event.preventDefault();
    if (dailyReport.trim().length < 3) return;
    setDailySaving(true);
    try {
      const { data } = await api.post(`/tasks/${detail.task.id}/daily-report`, { body: dailyReport.trim() });
      setToast({ message: data.message });
      await Promise.all([refreshDetail(), load()]);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setDailySaving(false);
    }
  };

  const startTimer = async (taskId) => {
    try {
      const { data } = await api.post('/timers/start', { taskId });
      setToast({ message: data.message });
      await load();
      if (detailOpen && Number(detail?.task?.id) === Number(taskId)) await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const stopTimer = async () => {
    try {
      const { data } = await api.post('/timers/stop', { note });
      setToast({ message: data.message });
      setAction(null);
      setNote('');
      setRatings(defaultReviewRatings());
      await load();
      if (detailOpen) await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const submitForReview = async () => {
    try {
      const { data } = await api.post(`/tasks/${action.task.id}/submit`, {
        completionNote: note,
        completionLink: completionLink || null,
      });
      setToast({ message: data.message });
      setAction(null);
      setNote('');
      setCompletionLink('');
      await load();
      if (detailOpen) await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const review = async (decision) => {
    try {
      const payload = { decision, note, ...(decision === 'approve' ? { ratings } : {}) };
      const { data } = await api.post(`/tasks/${action.task.id}/review`, payload);
      setToast({ message: data.message });
      setAction(null);
      setNote('');
      setRatings(defaultReviewRatings());
      await load();
      if (detailOpen) await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const submitManagerReview = async () => {
    try {
      const { data } = await api.post(`/tasks/${action.task.id}/manager-review`, {
        ratings: managerRatings,
        note,
      });
      setToast({ message: data.message });
      setAction(null);
      setNote('');
      setManagerRatings(defaultManagerReviewRatings());
      await load();
      if (detailOpen) await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const search = (event) => {
    event.preventDefault();
    load();
  };

  const taskGroups = useMemo(() => {
    const visibleSections = filters.sectionId
      ? sections.filter((section) => String(section.id) === String(filters.sectionId))
      : sections;
    const sectionMap = new Map(visibleSections.map((section) => [Number(section.id), { ...section, tasks: [] }]));
    const unsectioned = { id: 'unsectioned', title: 'بدون بخش', description: 'تسک‌هایی که هنوز به بخش خاصی منتقل نشده‌اند.', tasks: [] };
    tasks.forEach((task) => {
      const section = sectionMap.get(Number(task.section_id));
      if (section) section.tasks.push(task);
      else if (!task.section_id && !filters.sectionId) unsectioned.tasks.push(task);
    });
    const groups = [...sectionMap.values()];
    if (unsectioned.tasks.length) groups.push(unsectioned);
    return groups;
  }, [sections, tasks, filters.sectionId]);

  const gridClass = user.role === 'admin' ? 'tasks-grid tasks-grid-admin' : 'tasks-grid tasks-grid-team';

  return (
    <>
      <PageHeader
        title={reviewMode ? 'بازبینی تسک‌ها' : user.role === 'developer' ? 'تسک‌های من' : 'مدیریت تسک‌ها'}
        subtitle={selectedProject
          ? `${reviewMode ? 'تسک‌های در انتظار بازبینی' : 'تسک‌های'} پروژه «${selectedProject.name}»؛ مرتب‌شده بر اساس اولویت`
          : reviewMode
            ? 'ابتدا پروژه را انتخاب کنید تا تسک‌های منتظر بازبینی همان پروژه نمایش داده شوند.'
            : 'ابتدا پروژه را انتخاب کنید؛ سپس تسک‌های همان پروژه را ببینید یا تعریف کنید.'}
        action={!reviewMode && canCreateTask
          ? <button className="button button-primary" onClick={() => openCreate()}>+ تسک جدید برای این پروژه</button>
          : null}
      />

      {activeTimer && (
        <div className="timer-banner">
          <span className="pulse" />
          <div><small>در حال کار روی</small><strong>{activeTimer.task_title}</strong><span>{activeTimer.project_name}</span></div>
          <b dir="ltr">{formatDuration(activeElapsed)}</b>
          <button className="button button-danger" onClick={() => { setAction({ type: 'stop' }); setNote(''); }}>توقف تایمر</button>
        </div>
      )}

      <ProjectPicker projects={projects} value={filters.projectId} onChange={chooseProject} title="پروژه فعال برای مدیریت تسک‌ها" />
      {selectedProject && !canCreateTask && <div className="alert alert-warning">این پروژه بسته است؛ تسک‌ها فقط قابل مشاهده‌اند و تسک جدید ثبت نمی‌شود.</div>}

      {filters.projectId && (
        <form className="filters-bar" onSubmit={search}>
          <input className="filter-search" placeholder="جست‌وجوی عنوان یا شرح تسک…" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
          {sections.length > 0 && <select value={filters.sectionId} onChange={(event) => setFilters({ ...filters, sectionId: event.target.value })}><option value="">همه بخش‌ها</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select>}
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">همه وضعیت‌ها</option><option value="todo">برای انجام</option><option value="in_progress">در حال انجام</option><option value="review">در انتظار بازبینی</option><option value="changes_requested">نیازمند اصلاح</option><option value="done">انجام‌شده</option></select>
          <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}><option value="">همه اولویت‌ها</option><option value="urgent">فوری</option><option value="high">زیاد</option><option value="medium">متوسط</option><option value="low">کم</option></select>
          <select value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value })}><option value="">همه مهلت‌ها</option><option value="overdue">عقب‌افتاده</option><option value="today">موعد امروز</option><option value="week">هفت روز آینده</option></select>
          <button className="button button-small button-ghost">جست‌وجو</button><span>{tasks.length} تسک</span>
        </form>
      )}

      {!filters.projectId ? (
        <EmptyState title="یک پروژه انتخاب کنید" text="بعد از انتخاب پروژه، تسک‌های همان پروژه نمایش داده می‌شوند و می‌توانید تسک جدید تعریف کنید." />
      ) : loading ? <div className="screen-center small"><div className="spinner" /></div> : (tasks.length || sections.length) ? (
        <div className="task-section-groups">
          {taskGroups.map((group) => (
            <section className="task-section-group" key={group.id}>
              <header className="task-section-heading">
                <div><strong>{group.title}</strong><span>{group.description || 'بدون توضیحات بخش'}</span></div>
                <div className="task-section-heading-actions">
                  <b>{group.tasks.length} تسک</b>
                  {!reviewMode && canCreateTask && group.id !== 'unsectioned' && (
                    <button type="button" className="button button-small button-primary" onClick={() => openCreate(group.id)}>+ تسک در این بخش</button>
                  )}
                </div>
              </header>
              <div className={gridClass}>
          {!group.tasks.length && <div className="task-section-empty">هنوز تسکی در این بخش ثبت نشده است. از دکمه «تسک در این بخش» استفاده کنید.</div>}
          {group.tasks.map((task) => {
            const progress = checklistProgress(task);
            const checklistComplete = !progress.total || progress.completed === progress.total;
            return (
              <article className={`task-card priority-${task.priority}`} key={task.id}>
                <div className="task-card-header">
                  <div className="task-title-block">
                    <div className="task-code-row"><span className="task-sequence">{taskNumber(task)}</span><span className="project-tag">{task.project_code}</span></div>
                    <h3>{task.title}</h3>
                  </div>
                  <Badge type="priority" value={task.priority} />
                </div>
                <p>{task.description || 'توضیحی برای این تسک ثبت نشده است.'}</p>
                {progress.total > 0 && (
                  <div className="task-checklist-summary">
                    <div><strong>مراحل اجرا</strong><span>{progress.completed} از {progress.total}</span></div>
                    <div className="task-checklist-track"><i style={{ width: `${progress.percent}%` }} /></div>
                  </div>
                )}
                <div className="task-card-info">
                  <span><small>مسئول</small><strong>{task.assignee_name || 'تخصیص داده نشده'}</strong></span>
                  <span><small>مهلت شمسی</small><strong>{formatDate(task.due_date)}</strong></span>
                  <span><small>زمان ثبت‌شده</small><strong dir="ltr">{formatDuration(getTrackedSeconds(task))}</strong></span>
                  <span><small>تخمین</small><strong>{task.estimated_minutes ? `${task.estimated_minutes} دقیقه` : '—'}</strong></span>
                </div>
                {task.review_note && <div className="review-note"><strong>یادداشت بازبینی:</strong> {task.review_note}</div>}
                <div className="task-card-footer">
                  <div className="task-status-row"><Badge value={task.status} /><button type="button" className="comments-count" onClick={() => openDetail(task.id)}>◌ {task.comments_count || 0} پیام</button></div>
                  <div className="task-actions">
                    <button className="button button-small button-ghost" onClick={() => openDetail(task.id)}>جزئیات</button>
                    {canManageTasks && !['review', 'done'].includes(task.status) && <button className="button button-small button-ghost" onClick={() => openEdit(task)}>ویرایش</button>}
                    {canManageTasks && <button className="button button-small button-ghost-danger" onClick={() => deleteTask(task)}>حذف</button>}
                    {user.role === 'project_manager' && Number(task.assignee_id) === Number(user.id) && !['review', 'done'].includes(task.status) && Number(activeTimer?.task_id) !== Number(task.id) && (
                      <button className="button button-small button-success" disabled={!checklistComplete} onClick={() => completeManagerTask(task)}>تکمیل تسک شخصی</button>
                    )}
                    {['developer', 'project_manager'].includes(user.role) && Number(task.assignee_id) === Number(user.id) && !['review', 'done'].includes(task.status) && (!activeTimer
                      ? <button className="button button-small button-primary" onClick={() => startTimer(task.id)}>شروع تایمر</button>
                      : Number(activeTimer.task_id) === Number(task.id)
                        ? <button className="button button-small button-danger" onClick={() => { setAction({ type: 'stop', task }); setNote(''); }}>توقف</button>
                        : null)}
                    {user.role === 'developer' && ['in_progress', 'changes_requested'].includes(task.status) && Number(activeTimer?.task_id) !== Number(task.id) && (
                      <button
                        className="button button-small button-primary"
                        disabled={!checklistComplete}
                        title={!checklistComplete ? 'ابتدا تمام مراحل تسک را تیک بزنید.' : ''}
                        onClick={() => { setAction({ type: 'submit', task }); setNote(''); setCompletionLink(''); }}
                      >ارسال برای بازبینی</button>
                    )}
                    {user.role === 'developer' && task.status === 'done' && (task.has_manager_review
                      ? <span className="confidential-review-done">ارزیابی محرمانه ثبت شد</span>
                      : <button className="button button-small button-ghost" onClick={() => { setAction({ type: 'managerReview', task }); setNote(''); setManagerRatings(defaultManagerReviewRatings()); }}>ارزیابی محرمانه مدیر</button>)}
                    {user.role !== 'developer' && task.status === 'review' && <><button className="button button-small button-success" onClick={() => { setAction({ type: 'approve', task }); setNote(''); setRatings(defaultReviewRatings()); }}>تأیید و امتیازدهی</button><button className="button button-small button-ghost-danger" onClick={() => { setAction({ type: 'changes', task }); setNote(''); }}>برگشت</button></>}
                  </div>
                </div>
              </article>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      ) : <EmptyState title="برای این پروژه تسکی پیدا نشد" text="فیلترها را تغییر دهید یا اولین تسک این پروژه را تعریف کنید." />}

      {formMode && (
        <Modal title={formMode === 'create' ? 'تعریف تسک جدید' : 'ویرایش تسک'} wide onClose={() => setFormMode(null)}>
          <form className="form-grid" onSubmit={saveTask}>
            <div className="selected-project-field"><span>پروژه</span><strong>{projects.find((project) => String(project.id) === String(form.projectId))?.name || '—'}</strong><small>{projects.find((project) => String(project.id) === String(form.projectId))?.code || ''}</small></div>
            <label>بخش پروژه<select required={sections.length > 0} value={form.sectionId} onChange={(event) => setForm({ ...form, sectionId: event.target.value })}><option value="">{sections.length ? 'انتخاب بخش الزامی است' : 'بدون بخش'}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>
            <label>مسئول<select value={form.assigneeId} onChange={(event) => setForm({ ...form, assigneeId: event.target.value })}><option value="">بدون مسئول</option>{formAssignees.map((member) => <option key={member.id} value={member.id}>{member.full_name}{member.is_project_manager ? ' — مدیر پروژه اصلی' : ''}</option>)}</select></label>
            {form.sectionId && <div className="section-assignee-hint full">مسئول‌های قابل انتخاب از تیم همان بخش گرفته می‌شوند. برای اضافه‌کردن برنامه‌نویس، در «پروژه‌ها ← جزئیات پروژه» تیم آن بخش را مشخص کنید.</div>}
            <label className="full">عنوان<input required minLength="2" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label>اولویت<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">کم</option><option value="medium">متوسط</option><option value="high">زیاد</option><option value="urgent">فوری</option></select></label>
            <label>مهلت شمسی<JalaliDatePicker value={form.dueDate} onChange={(dueDate) => setForm({ ...form, dueDate })} /></label>
            <label>زمان تخمینی (دقیقه)<input type="number" min="1" value={form.estimatedMinutes} onChange={(event) => setForm({ ...form, estimatedMinutes: event.target.value })} /></label>
            <label className="full">شرح تسک<textarea rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="task-checklist-builder full">
              <div className="task-checklist-builder-head">
                <div><strong>چک‌لیست اختیاری داخل تسک</strong><span>برای کارهای خیلی ریز استفاده کنید؛ ساختار اصلی پروژه از «بخش‌ها» و «تسک‌ها» تشکیل می‌شود.</span></div>
                <button type="button" className="button button-small button-ghost" onClick={addChecklistDraft}>+ افزودن مرحله</button>
              </div>
              <div className="task-checklist-builder-list">
                {!form.checklistItems.length && <div className="task-checklist-empty">برای این تسک چک‌لیست لازم نیست؛ فقط در صورت نیاز چند مورد خیلی ریز اضافه کنید.</div>}
                {form.checklistItems.map((item, index) => (
                  <div className="task-checklist-builder-row" key={`${item.id || 'new'}-${index}`}>
                    <b>{String(index + 1).padStart(2, '0')}</b>
                    <div className="task-checklist-builder-fields">
                      <input value={item.title} maxLength="500" placeholder="عنوان ریزتسک؛ مثلاً: تکمیل طراحی صفحه ورود" onChange={(event) => updateChecklistDraft(index, 'title', event.target.value)} />
                      <textarea rows="2" maxLength="5000" value={item.description || ''} placeholder="توضیحات ریزتسک؛ جزئیات اجرا، نکات مهم یا خروجی مورد انتظار..." onChange={(event) => updateChecklistDraft(index, 'description', event.target.value)} />
                    </div>
                    <button type="button" aria-label="حذف مرحله" onClick={() => removeChecklistDraft(index)}>×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-actions full"><button type="button" className="button button-ghost" onClick={() => setFormMode(null)}>انصراف</button><button className="button button-primary" disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره تسک'}</button></div>
          </form>
        </Modal>
      )}

      {detailOpen && (
        <Modal title="جزئیات تسک" wide onClose={() => setDetailOpen(false)}>
          {!detail ? <div className="screen-center small"><div className="spinner" /></div> : (() => {
            const progress = checklistProgress(detail.task);
            const canToggle = (['developer', 'project_manager'].includes(user.role) && Number(detail.task.assignee_id) === Number(user.id)) || user.role === 'admin';
            const canDailyReport = ['developer', 'project_manager'].includes(user.role) && Number(detail.task.assignee_id) === Number(user.id) && !['done', 'review'].includes(detail.task.status);
            return (
              <div className="task-detail">
                <div className="detail-heading">
                  <div><div className="task-code-row"><span className="task-sequence large">{taskNumber(detail.task)}</span><span className="project-tag">{detail.task.project_code}</span></div><h2>{detail.task.title}</h2></div>
                  <div><Badge type="priority" value={detail.task.priority} /> <Badge value={detail.task.status} /></div>
                </div>
                {detail.task.section_title && <div className="task-section-chip"><span>بخش پروژه</span><strong>{detail.task.section_title}</strong></div>}
                <p className="detail-description">{detail.task.description || 'توضیحی ثبت نشده است.'}</p>
                <div className="detail-stats"><div><span>مسئول</span><strong>{detail.task.assignee_name || 'بدون مسئول'}</strong></div><div><span>مهلت شمسی</span><strong>{formatDate(detail.task.due_date)}</strong></div><div><span>ثبت‌شده</span><strong dir="ltr">{formatDuration(detailTrackedSeconds)}</strong></div><div><span>تخمین</span><strong>{detail.task.estimated_minutes ? `${detail.task.estimated_minutes} دقیقه` : '—'}</strong></div></div>

                {detail.checklist.length > 0 && (
                  <div className="detail-section task-checklist-detail">
                    <div className="detail-section-head"><h3>مراحل اجرای تسک</h3><span>{progress.completed} از {progress.total} انجام‌شده</span></div>
                    <div className="task-checklist-track large"><i style={{ width: `${progress.percent}%` }} /></div>
                    <div className="task-checklist-items">
                      {detail.checklist.map((item, index) => (
                        <label className={item.is_completed ? 'is-completed' : ''} key={item.id}>
                          <input
                            type="checkbox"
                            checked={Boolean(item.is_completed)}
                            disabled={!canToggle || ['review', 'done'].includes(detail.task.status)}
                            onChange={() => toggleChecklist(item)}
                          />
                          <b>{String(index + 1).padStart(2, '0')}</b>
                          <span className="task-checklist-item-content">
                            <strong>{item.title}</strong>
                            {item.description && <em>{item.description}</em>}
                          </span>
                          {item.is_completed && <small>{item.completed_by_name || 'انجام‌شده'} · {formatDate(item.completed_at, true)}</small>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {(detail.task.completion_note || detail.task.review_note) && <div className="delivery-grid">{detail.task.completion_note && <div className="delivery-note"><strong>توضیحات تحویل</strong><p>{detail.task.completion_note}</p>{detail.task.completion_link && <a href={detail.task.completion_link} target="_blank" rel="noreferrer">بازکردن لینک تحویل ↗</a>}</div>}{detail.task.review_note && <div className="review-note"><strong>نظر مدیر</strong><p>{detail.task.review_note}</p></div>}</div>}

                <div className="detail-section">
                  <div className="detail-section-head"><h3>گزارش‌های روزانه روی این تسک</h3><span>{detail.dailyReports.length} گزارش</span></div>
                  {canDailyReport && (
                    <form className="daily-task-report-form" onSubmit={saveDailyReport}>
                      <div><strong>گزارش امروز من</strong><span>مختصر بنویسید امروز روی این تسک چه کاری انجام دادید، چه نتیجه‌ای گرفتید و چه مانعی داشتید.</span></div>
                      <textarea rows="4" value={dailyReport} onChange={(event) => setDailyReport(event.target.value)} placeholder="امروز چه کارهایی روی این تسک انجام شد؟" />
                      <button className="button button-primary" disabled={dailySaving || dailyReport.trim().length < 3}>{dailySaving ? 'در حال ذخیره…' : 'ثبت یا ویرایش گزارش امروز'}</button>
                    </form>
                  )}
                  {detail.dailyReports.length ? (
                    <div className="daily-task-report-list">
                      {detail.dailyReports.map((report) => (
                        <article key={report.id}>
                          <div><strong>{report.user_name}</strong><span><RoleLabel role={report.user_role} /> · {formatDate(report.report_date)}</span></div>
                          <p>{report.body}</p>
                          <small>آخرین ویرایش: {formatDate(report.updated_at, true)}</small>
                        </article>
                      ))}
                    </div>
                  ) : <p className="muted-text">هنوز گزارش روزانه‌ای برای این تسک ثبت نشده است.</p>}
                </div>

                <div className="detail-section"><div className="detail-section-head"><h3>ریز زمان‌های همین تسک</h3><span>{detailTimeLogs.length} بازه</span></div>{detailTimeLogs.length ? <div className="mini-log-list">{detailTimeLogs.map((log) => <div key={log.id}><span><strong>{log.user_name}</strong><small>{formatDate(log.started_at, true)} تا {log.ended_at ? formatDate(log.ended_at, true) : 'اکنون'}</small></span><b dir="ltr">{formatDuration(log.effective_seconds)}</b><p>{log.note || 'بدون یادداشت'}</p></div>)}</div> : <EmptyState title="زمانی ثبت نشده" text="هنوز تایمری برای این تسک ثبت نشده است." />}</div>
                <div className="detail-section"><div className="detail-section-head"><h3>گفت‌وگوی تسک</h3><span>{detail.comments.length} پیام</span></div><div className="comments-list">{detail.comments.length ? detail.comments.map((item) => <div className="comment-item" key={item.id}><div className="avatar small">{item.user_name.slice(0, 1)}</div><div><div><strong>{item.user_name}</strong><span><RoleLabel role={item.user_role} /> · {formatDate(item.created_at, true)}</span>{(user.role === 'admin' || Number(item.user_id) === Number(user.id)) && <button type="button" onClick={() => deleteComment(item.id)}>حذف</button>}</div><p>{item.body}</p></div></div>) : <p className="muted-text">هنوز پیامی ثبت نشده است.</p>}</div><form className="comment-form" onSubmit={addComment}><textarea rows="3" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="پیام یا نکته‌ای درباره این تسک بنویسید…" /><button className="button button-primary" disabled={!comment.trim()}>ثبت پیام</button></form></div>
                <div className="modal-actions">
                  <button className="button button-ghost" onClick={() => setDetailOpen(false)}>بستن</button>
                  {canManageTasks && !['review', 'done'].includes(detail.task.status) && <button className="button button-primary" onClick={() => openEdit(detail.task)}>ویرایش تسک</button>}
                  {canManageTasks && <button className="button button-ghost-danger" onClick={() => deleteTask(detail.task)}>حذف تسک</button>}
                  {['developer', 'project_manager'].includes(user.role) && Number(detail.task.assignee_id) === Number(user.id) && !['review', 'done'].includes(detail.task.status) && (!activeTimer ? <button className="button button-primary" onClick={() => startTimer(detail.task.id)}>شروع تایمر</button> : Number(activeTimer.task_id) === Number(detail.task.id) ? <button className="button button-danger" onClick={() => { setAction({ type: 'stop', task: detail.task }); setNote(''); }}>توقف تایمر</button> : null)}
                  {user.role === 'project_manager' && Number(detail.task.assignee_id) === Number(user.id) && !['review', 'done'].includes(detail.task.status) && Number(activeTimer?.task_id) !== Number(detail.task.id) && <button className="button button-success" disabled={progress.total > progress.completed} onClick={() => completeManagerTask(detail.task)}>تکمیل تسک شخصی</button>}
                  {user.role === 'developer' && ['in_progress', 'changes_requested'].includes(detail.task.status) && Number(activeTimer?.task_id) !== Number(detail.task.id) && <button className="button button-primary" disabled={progress.total > progress.completed} onClick={() => { setAction({ type: 'submit', task: detail.task }); setNote(''); setCompletionLink(''); }}>ارسال برای بازبینی</button>}
                  {user.role === 'developer' && detail.task.status === 'done' && (detail.task.has_manager_review ? <span className="confidential-review-done">ارزیابی محرمانه ثبت شده است</span> : <button className="button button-primary" onClick={() => { setAction({ type: 'managerReview', task: detail.task }); setNote(''); setManagerRatings(defaultManagerReviewRatings()); }}>ارزیابی محرمانه مدیر پروژه</button>)}
                  {user.role !== 'developer' && detail.task.status === 'review' && <><button className="button button-success" onClick={() => { setAction({ type: 'approve', task: detail.task }); setNote(''); setRatings(defaultReviewRatings()); }}>تأیید و امتیازدهی</button><button className="button button-ghost-danger" onClick={() => { setAction({ type: 'changes', task: detail.task }); setNote(''); }}>برگشت برای اصلاح</button></>}
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {action && (
        <Modal
          title={action.type === 'stop' ? 'توقف تایمر' : action.type === 'submit' ? 'ارسال تسک برای بازبینی' : action.type === 'approve' ? 'تأیید نهایی و ارزیابی محرمانه برنامه‌نویس' : action.type === 'managerReview' ? 'ارزیابی محرمانه مدیر پروژه' : 'برگشت برای اصلاح'}
          wide
          onClose={() => setAction(null)}
        >
          <div className="action-dialog">
            {['approve', 'changes'].includes(action.type) && action.task?.completion_note && <div className="delivery-note"><strong>توضیحات تحویل برنامه‌نویس</strong><p>{action.task.completion_note}</p>{action.task.completion_link && <a href={action.task.completion_link} target="_blank" rel="noreferrer">لینک تحویل ↗</a>}</div>}
            {['approve', 'managerReview'].includes(action.type) && <div className="confidential-review-notice"><strong>ارزیابی محرمانه</strong><p>امتیازها و متن نظر بعد از ثبت فقط برای ادمین قابل مشاهده هستند و برای طرف مقابل نمایش داده نمی‌شوند.</p></div>}
            <p>{action.type === 'stop' ? 'خلاصه فعالیت این بازه را ثبت کنید.' : action.type === 'submit' ? 'نتیجه کار، تغییرات و نکات لازم برای بازبینی را بنویسید.' : action.type === 'approve' ? 'به عملکرد برنامه‌نویس امتیاز بدهید. این ارزیابی فقط در پنل ادمین ذخیره می‌شود.' : action.type === 'managerReview' ? `به عملکرد مدیر پروژه ${action.task?.manager_name ? `«${action.task.manager_name}»` : ''} امتیاز بدهید و نظر محرمانه خود را بنویسید.` : 'مواردی که باید اصلاح شوند را دقیق بنویسید.'}</p>
            {action.type === 'approve' && <div className="review-criteria-grid">{REVIEW_CRITERIA.map((criterion) => <div className="review-criterion-card" key={criterion.key}><strong>{criterion.label}</strong><small>{criterion.hint}</small><div className="rating-stars large">{[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} className={score <= Number(ratings[criterion.key] || 0) ? 'is-filled' : ''} onClick={() => setRatings((current) => ({ ...current, [criterion.key]: score }))} aria-label={`${score} ستاره برای ${criterion.label}`}>★</button>)}</div></div>)}</div>}
            {action.type === 'managerReview' && <div className="review-criteria-grid">{MANAGER_REVIEW_CRITERIA.map((criterion) => <div className="review-criterion-card" key={criterion.key}><strong>{criterion.label}</strong><small>{criterion.hint}</small><div className="rating-stars large">{[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} className={score <= Number(managerRatings[criterion.key] || 0) ? 'is-filled' : ''} onClick={() => setManagerRatings((current) => ({ ...current, [criterion.key]: score }))} aria-label={`${score} ستاره برای ${criterion.label}`}>★</button>)}</div></div>)}</div>}
            {action.type === 'approve' && <div className="review-average-chip">میانگین این ارزیابی: {reviewAverage} از ۵ ★</div>}
            {action.type === 'managerReview' && <div className="review-average-chip">میانگین این ارزیابی: {managerReviewAverage} از ۵ ★</div>}
            <textarea autoFocus rows="5" value={note} onChange={(event) => setNote(event.target.value)} placeholder={action.type === 'approve' ? 'نظر محرمانه درباره عملکرد برنامه‌نویس (اختیاری)' : action.type === 'managerReview' ? 'نظر محرمانه درباره مدیر پروژه (الزامی)' : 'توضیحات…'} />
            {action.type === 'submit' && <input className="action-link" type="url" value={completionLink} onChange={(event) => setCompletionLink(event.target.value)} placeholder="لینک Pull Request یا خروجی کار (اختیاری)" />}
            <div className="modal-actions"><button className="button button-ghost" onClick={() => setAction(null)}>انصراف</button>{action.type === 'stop' && <button className="button button-danger" onClick={stopTimer}>توقف و ثبت زمان</button>}{action.type === 'submit' && <button className="button button-primary" disabled={note.trim().length < 5} onClick={submitForReview}>ارسال برای مدیر</button>}{action.type === 'approve' && <button className="button button-success" onClick={() => review('approve')}>تأیید و ثبت محرمانه</button>}{action.type === 'managerReview' && <button className="button button-primary" disabled={note.trim().length < 3} onClick={submitManagerReview}>ثبت محرمانه برای ادمین</button>}{action.type === 'changes' && <button className="button button-danger" disabled={note.trim().length < 3} onClick={() => review('request_changes')}>برگشت تسک</button>}</div>
          </div>
        </Modal>
      )}
      <Toast {...toast} onClose={() => setToast(null)} />
    </>
  );
}
