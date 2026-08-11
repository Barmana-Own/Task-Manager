import { useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, EmptyState, formatDate, formatDuration, PageHeader, Toast } from '../components/UI.jsx';

const initialForm = {
  name: '', code: '', description: '', managerId: '', memberIds: [], status: 'planning', startDate: '', targetDate: '',
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [form, setForm] = useState(initialForm);
  const [modalMode, setModalMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [sectionForm, setSectionForm] = useState({ id: null, title: '', description: '' });
  const [sectionSaving, setSectionSaving] = useState(false);
  const [sectionEditorOpen, setSectionEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const load = async () => {
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
      const requests = [api.get(`/projects${query ? `?${query}` : ''}`)];
      if (user.role === 'admin') requests.push(api.get('/users'));
      else if (user.role === 'project_manager' || user.task_assignment_access) requests.push(api.get('/users/assignable'));
      const [projectResponse, userResponse] = await Promise.all(requests);
      setProjects(projectResponse.data.projects);
      if (userResponse) setUsers((userResponse.data.users || []).filter((item) => item.is_active));
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters.status]);

  const managers = useMemo(
    () => users.filter((item) => item.role === 'project_manager' || Boolean(item.manager_access)),
    [users],
  );
  const developers = useMemo(() => users.filter((item) => item.role === 'developer'), [users]);
  const projectMemberCandidates = useMemo(
    () => users.filter((item) => item.role === 'developer' || item.role === 'project_manager' || Boolean(item.manager_access)),
    [users],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(initialForm);
    setModalMode('create');
  };

  const fetchDetail = async (projectId) => {
    const { data } = await api.get(`/projects/${projectId}`);
    return data;
  };

  const openDetail = async (projectId) => {
    try {
      setDetail(null);
      setSectionForm({ id: null, title: '', description: '' });
      setSectionEditorOpen(false);
      setModalMode('detail');
      const data = await fetchDetail(projectId);
      setDetail(data);
    } catch (error) {
      setModalMode(null);
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const refreshDetail = async () => {
    if (!detail?.project?.id) return;
    const data = await fetchDetail(detail.project.id);
    setDetail(data);
  };

  const openEdit = async (projectId) => {
    try {
      const data = await fetchDetail(projectId);
      const project = data.project;
      setEditingId(project.id);
      setForm({
        name: project.name,
        code: project.code,
        description: project.description || '',
        managerId: String(project.manager_id || ''),
        memberIds: data.members.filter((member) => !member.is_project_manager).map((member) => Number(member.id)),
        status: project.status,
        startDate: project.start_date || '',
        targetDate: project.target_date || '',
      });
      setModalMode('edit');
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingId(null);
    setDetail(null);
    setSectionForm({ id: null, title: '', description: '' });
    setSectionEditorOpen(false);
    setForm(initialForm);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        code: form.code.toUpperCase(),
        startDate: form.startDate || null,
        targetDate: form.targetDate || null,
      };
      if (user.role === 'admin') {
        payload.managerId = Number(form.managerId);
        payload.memberIds = form.memberIds.map(Number);
      } else {
        delete payload.managerId;
        payload.memberIds = form.memberIds.map(Number);
        delete payload.code;
      }
      const response = modalMode === 'create'
        ? await api.post('/projects', payload)
        : await api.patch(`/projects/${editingId}`, payload);
      setToast({ message: response.data.message });
      closeModal();
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const saveSection = async (event) => {
    event.preventDefault();
    if (!detail?.project?.id || sectionForm.title.trim().length < 2) return;
    setSectionSaving(true);
    try {
      const payload = { title: sectionForm.title.trim(), description: sectionForm.description.trim() || null };
      const response = sectionForm.id
        ? await api.patch(`/projects/${detail.project.id}/sections/${sectionForm.id}`, payload)
        : await api.post(`/projects/${detail.project.id}/sections`, payload);
      setToast({ message: response.data.message });
      setSectionForm({ id: null, title: '', description: '' });
      setSectionEditorOpen(false);
      await Promise.all([refreshDetail(), load()]);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSectionSaving(false);
    }
  };

  const editSection = (section) => {
    setSectionForm({ id: Number(section.id), title: section.title, description: section.description || '' });
    setSectionEditorOpen(true);
  };

  const deleteSection = async (section) => {
    if (!window.confirm(`بخش «${section.title}» حذف شود؟\n\nتسک‌های این بخش حذف نمی‌شوند و به «بدون بخش» منتقل می‌شوند.`)) return;
    try {
      const { data } = await api.delete(`/projects/${detail.project.id}/sections/${section.id}`);
      setToast({ message: data.message });
      if (Number(sectionForm.id) === Number(section.id)) setSectionForm({ id: null, title: '', description: '' });
      setSectionEditorOpen(false);
      await Promise.all([refreshDetail(), load()]);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const saveSectionMembers = async (section, memberIds) => {
    try {
      const { data } = await api.put(`/projects/${detail.project.id}/sections/${section.id}/members`, { memberIds });
      setToast({ message: data.message });
      await refreshDetail();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const saveProjectMembers = async (memberIds) => {
    try {
      const { data } = await api.put(`/projects/${detail.project.id}/members`, { memberIds });
      setToast({ message: data.message });
      await Promise.all([refreshDetail(), load()]);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const applySearch = (event) => {
    event.preventDefault();
    setLoading(true);
    load();
  };

  const canManageSections = user.role !== 'developer' || Boolean(user.task_assignment_access);

  return (
    <>
      <PageHeader
        title="پروژه‌ها"
        subtitle="تعریف پروژه، تقسیم آن به بخش‌های کاری و مدیریت اعضا و تحویل‌ها"
        action={user.role !== 'developer' ? <button className="button button-primary" onClick={openCreate}>+ پروژه جدید</button> : null}
      />

      <form className="filters-bar" onSubmit={applySearch}>
        <input className="filter-search" placeholder="جست‌وجوی نام یا کد پروژه…" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">همه وضعیت‌ها</option><option value="planning">برنامه‌ریزی</option><option value="active">فعال</option><option value="on_hold">متوقف</option><option value="completed">تکمیل‌شده</option><option value="archived">آرشیو</option>
        </select>
        <button className="button button-ghost button-small">جست‌وجو</button>
        <span>{projects.length} پروژه</span>
      </form>

      {loading ? <div className="screen-center small"><div className="spinner" /></div> : projects.length ? (
        <div className="project-grid">
          {projects.map((project) => {
            const progress = Number(project.tasks_count) ? Math.round((Number(project.done_tasks_count) / Number(project.tasks_count)) * 100) : 0;
            return (
              <article className="project-card" key={project.id}>
                <div className="project-card-top"><div className="project-code">{project.code}</div><Badge value={project.status} /></div>
                <h3>{project.name}</h3>
                <p>{project.description || 'برای این پروژه توضیحی ثبت نشده است.'}</p>
                <div className="project-manager"><div className="avatar small">{project.manager_name?.slice(0, 1) || '—'}</div><div><span>مدیر پروژه</span><strong>{project.manager_name}</strong></div></div>
                <div className="project-dates"><span>شروع: {formatDate(project.start_date)}</span><span>هدف: {formatDate(project.target_date)}</span></div>
                <div className="project-progress"><div><span>پیشرفت تسک‌ها</span><strong>{progress}%</strong></div><div className="progress-bar"><i style={{ width: `${progress}%` }} /></div></div>
                <div className="project-footer"><span>{project.members_count} عضو</span><span>{project.sections_count || 0} بخش</span><span>{project.done_tasks_count} از {project.tasks_count} تکمیل</span><span>{formatDuration(project.tracked_seconds)}</span></div>
                <div className="project-actions">
                  <button className="button button-small button-ghost" onClick={() => openDetail(project.id)}>جزئیات و بخش‌ها</button>
                  {user.role !== 'developer' && <button className="button button-small button-primary" onClick={() => openEdit(project.id)}>ویرایش</button>}
                </div>
              </article>
            );
          })}
        </div>
      ) : <EmptyState title="پروژه‌ای پیدا نشد" text="فیلترها را تغییر دهید یا یک پروژه جدید ایجاد کنید." />}

      {(modalMode === 'create' || modalMode === 'edit') && (
        <Modal title={modalMode === 'create' ? 'ایجاد پروژه جدید' : 'ویرایش پروژه'} wide onClose={closeModal}>
          <form className="form-grid" onSubmit={submit}>
            <label>نام پروژه<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            {user.role === 'admin' && <label>کد پروژه<input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="مثلاً WEB-001" /></label>}
            {user.role === 'admin' && <label>مدیر پروژه<select required value={form.managerId} onChange={(event) => setForm({ ...form, managerId: event.target.value })}><option value="">انتخاب کنید</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}</select></label>}
            <label>وضعیت<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="planning">برنامه‌ریزی</option><option value="active">فعال</option><option value="on_hold">متوقف</option><option value="completed">تکمیل‌شده</option><option value="archived">آرشیو</option></select></label>
            <label>تاریخ شروع شمسی<JalaliDatePicker value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} max={form.targetDate || undefined} /></label>
            <label>تاریخ هدف شمسی<JalaliDatePicker value={form.targetDate} onChange={(targetDate) => setForm({ ...form, targetDate })} min={form.startDate || undefined} /></label>
            <label className="full">توضیحات<textarea rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            {user.role !== 'developer' && <div className="full"><span className="field-label">اعضای پروژه</span><div className="member-picker">
              {projectMemberCandidates.length ? projectMemberCandidates.filter((candidate) => String(candidate.id) !== String(form.managerId)).map((candidate) => <label className="check-card project-member-check" key={candidate.id}><input type="checkbox" checked={form.memberIds.includes(Number(candidate.id))} onChange={(event) => setForm({ ...form, memberIds: event.target.checked ? [...form.memberIds, Number(candidate.id)] : form.memberIds.filter((id) => id !== Number(candidate.id)) })} /><div className="avatar small">{candidate.full_name.slice(0, 1)}</div><span><strong>{candidate.full_name}</strong><small>{candidate.role === 'project_manager' || candidate.manager_access ? 'مدیر پروژه' : 'برنامه‌نویس'}</small></span></label>) : <span>کاربر فعالی برای افزودن به پروژه وجود ندارد.</span>}
            </div></div>}
            <div className="modal-actions full"><button type="button" className="button button-ghost" onClick={closeModal}>انصراف</button><button className="button button-primary" disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره پروژه'}</button></div>
          </form>
        </Modal>
      )}

      {modalMode === 'detail' && (
        <Modal title="جزئیات و ساختار پروژه" wide onClose={closeModal}>
          {!detail ? <div className="screen-center small"><div className="spinner" /></div> : (
            <div className="project-detail">
              <div className="detail-heading"><div><span className="project-code">{detail.project.code}</span><h2>{detail.project.name}</h2></div><Badge value={detail.project.status} /></div>
              <p>{detail.project.description || 'توضیحی ثبت نشده است.'}</p>
              <div className="detail-stats"><div><span>مدیر</span><strong>{detail.project.manager_name}</strong></div><div><span>بخش‌ها</span><strong>{detail.sections?.length || 0}</strong></div><div><span>تسک‌ها</span><strong>{detail.project.tasks_count}</strong></div><div><span>زمان ثبت‌شده</span><strong dir="ltr">{formatDuration(detail.project.tracked_seconds)}</strong></div></div>

              <section className="project-sections-panel project-sections-pro">
                <div className="project-sections-toolbar">
                  <div className="project-sections-title">
                    <span>ساختار اجرایی پروژه</span>
                    <h3>بخش‌های پروژه</h3>
                    <p>پروژه را به ماژول، فاز یا حوزه کاری تقسیم کنید؛ تسک‌های هر حوزه بعداً داخل همان بخش قرار می‌گیرند.</p>
                  </div>
                  <div className="project-sections-toolbar-actions">
                    <div className="project-sections-counter"><strong>{detail.sections?.length || 0}</strong><span>بخش تعریف‌شده</span></div>
                    {canManageSections && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => {
                          setSectionForm({ id: null, title: '', description: '' });
                          setSectionEditorOpen((value) => !value);
                        }}
                      >
                        {sectionEditorOpen && !sectionForm.id ? 'بستن فرم' : '+ بخش جدید'}
                      </button>
                    )}
                  </div>
                </div>

                {canManageSections && sectionEditorOpen && (
                  <form className="project-section-editor" onSubmit={saveSection}>
                    <div className="project-section-editor-head">
                      <div>
                        <strong>{sectionForm.id ? 'ویرایش بخش پروژه' : 'تعریف بخش جدید'}</strong>
                        <span>{sectionForm.id ? 'عنوان و توضیحات این بخش را اصلاح کنید.' : 'یک حوزه کاری مشخص تعریف کنید تا تسک‌های مرتبط زیر آن قرار بگیرند.'}</span>
                      </div>
                      <span className="project-section-editor-mode">{sectionForm.id ? 'ویرایش' : 'جدید'}</span>
                    </div>
                    <div className="project-section-editor-fields">
                      <label>عنوان بخش
                        <input required minLength="2" maxLength="180" value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} placeholder="مثلاً CRM، پنل سرمایه‌گذار یا بک‌اند" />
                      </label>
                      <label>توضیحات و محدوده کاری
                        <textarea rows="3" maxLength="10000" value={sectionForm.description} onChange={(event) => setSectionForm({ ...sectionForm, description: event.target.value })} placeholder="هدف این بخش، خروجی مورد انتظار و محدوده کار را بنویسید…" />
                      </label>
                    </div>
                    <div className="project-section-editor-actions">
                      <button type="button" className="button button-ghost" onClick={() => { setSectionForm({ id: null, title: '', description: '' }); setSectionEditorOpen(false); }}>انصراف</button>
                      <button className="button button-primary" disabled={sectionSaving}>{sectionSaving ? 'در حال ذخیره…' : sectionForm.id ? 'ذخیره تغییرات' : 'ایجاد بخش'}</button>
                    </div>
                  </form>
                )}

                {detail.sections?.length ? (
                  <div className="project-section-board">
                    {detail.sections.map((section, index) => {
                      const total = Number(section.tasks_count || 0);
                      const done = Number(section.done_tasks_count || 0);
                      const progress = total ? Math.round((done / total) * 100) : 0;
                      return (
                        <article className="project-section-card" key={section.id}>
                          <div className="project-section-card-head">
                            <div className="project-section-number">{String(index + 1).padStart(2, '0')}</div>
                            {canManageSections && <div className="project-section-card-actions"><button type="button" onClick={() => editSection(section)}>ویرایش</button><button type="button" className="danger" onClick={() => deleteSection(section)}>حذف</button></div>}
                          </div>
                          <div className="project-section-card-copy">
                            <span>بخش {String(index + 1).padStart(2, '0')}</span>
                            <h4>{section.title}</h4>
                            <p>{section.description || 'برای این بخش هنوز توضیحی ثبت نشده است.'}</p>
                          </div>
                          {canManageSections && (
                            <div className="section-team-manager">
                              <div className="section-team-manager-head"><strong>برنامه‌نویس‌های این بخش</strong><span>{section.members?.length || 0} نفر</span></div>
                              <div className="section-team-manager-list">
                                {developers.map((developer) => {
                                  const checked = (section.members || []).some((member) => Number(member.id) === Number(developer.id));
                                  return <label key={developer.id} className={checked ? 'section-team-chip active' : 'section-team-chip'}><input type="checkbox" checked={checked} onChange={(event) => {
                                    const current = (section.members || []).map((member) => Number(member.id));
                                    const next = event.target.checked ? [...new Set([...current, Number(developer.id)])] : current.filter((id) => id !== Number(developer.id));
                                    saveSectionMembers(section, next);
                                  }} /><span>{developer.full_name}</span></label>;
                                })}
                                {!developers.length && <small>برنامه‌نویس فعالی برای انتخاب وجود ندارد.</small>}
                              </div>
                            </div>
                          )}
                          {!canManageSections && section.members?.length > 0 && <div className="section-team-readonly"><strong>تیم بخش:</strong> {section.members.map((member) => member.full_name).join('، ')}</div>}
                          <div className="project-section-card-stats">
                            <div><strong>{total}</strong><span>کل تسک</span></div>
                            <div><strong>{done}</strong><span>تکمیل‌شده</span></div>
                            <div><strong>{progress}%</strong><span>پیشرفت</span></div>
                          </div>
                          <div className="project-section-progress"><i style={{ width: `${progress}%` }} /></div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="project-sections-empty">
                    <div className="project-sections-empty-icon">＋</div>
                    <div><strong>ساختار پروژه هنوز بخش‌بندی نشده</strong><p>برای پروژه‌های بزرگ، حوزه‌هایی مثل طراحی، بک‌اند، CRM، محتوا یا گزارش‌ها را به‌صورت بخش جدا ایجاد کنید.</p></div>
                    {canManageSections && <button type="button" className="button button-ghost" onClick={() => setSectionEditorOpen(true)}>اولین بخش را بساز</button>}
                  </div>
                )}
              </section>

              <section className="project-team-panel">
                <div className="project-team-panel-head">
                  <div><span>تیم پروژه</span><h3>اعضای پروژه و سمت‌ها</h3><p>مدیر اصلی پروژه همیشه عضو تیم است. برنامه‌نویس‌ها و مدیران همکار را می‌توانید به پروژه اضافه کنید.</p></div>
                  <strong>{detail.members?.length || 0} نفر</strong>
                </div>

                {canManageSections && projectMemberCandidates.length > 0 && (
                  <div className="project-team-picker">
                    {projectMemberCandidates.map((candidate) => {
                      const isPrimaryManager = Number(candidate.id) === Number(detail.project.manager_id);
                      const checked = isPrimaryManager || (detail.members || []).some((member) => Number(member.id) === Number(candidate.id));
                      return (
                        <label key={candidate.id} className={checked ? 'project-team-pick active' : 'project-team-pick'}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isPrimaryManager}
                            onChange={(event) => {
                              const current = (detail.members || []).filter((member) => !member.is_project_manager).map((member) => Number(member.id));
                              const next = event.target.checked
                                ? [...new Set([...current, Number(candidate.id)])]
                                : current.filter((id) => id !== Number(candidate.id));
                              saveProjectMembers(next);
                            }}
                          />
                          <div className="avatar small">{candidate.full_name.slice(0, 1)}</div>
                          <span>
                            <strong>{candidate.full_name}</strong>
                            <small>{isPrimaryManager ? 'مدیر پروژه اصلی' : (candidate.role === 'project_manager' || candidate.manager_access ? 'مدیر پروژه' : 'برنامه‌نویس')}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="detail-members project-team-roster">
                  {detail.members.length ? detail.members.map((member) => {
                    const roleLabel = member.is_project_manager
                      ? 'مدیر پروژه اصلی'
                      : (member.role === 'project_manager' || member.manager_access ? 'مدیر پروژه' : 'برنامه‌نویس');
                    return (
                      <div key={member.id} className="project-team-member">
                        <div className="avatar small">{member.full_name.slice(0, 1)}</div>
                        <span>
                          <strong>{member.full_name}</strong>
                          <small>{member.done_tasks || 0} از {member.assigned_tasks || 0} تسک تکمیل</small>
                        </span>
                        <em className={member.is_project_manager || member.role === 'project_manager' || member.manager_access ? 'team-role manager' : 'team-role developer'}>{roleLabel}</em>
                      </div>
                    );
                  }) : <p>عضوی برای پروژه ثبت نشده است.</p>}
                </div>
              </section>
              <div className="modal-actions"><button className="button button-ghost" onClick={closeModal}>بستن</button>{user.role !== 'developer' && <button className="button button-primary" onClick={() => openEdit(detail.project.id)}>ویرایش پروژه</button>}</div>
            </div>
          )}
        </Modal>
      )}
      <Toast {...toast} onClose={() => setToast(null)} />
    </>
  );
}
