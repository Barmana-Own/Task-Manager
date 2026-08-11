import { useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import { EmptyState, formatDate, PageHeader, RoleLabel, Toast } from '../components/UI.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const initialForm = { fullName: '', username: '', email: '', password: '', role: 'developer', managerAccess: false, adminAccess: false, taskAssignmentAccess: false };

function ScoreBadge({ value, count }) {
  if (value === null || value === undefined) return <span className="muted-text">بدون ارزیابی</span>;
  return <span className="review-average-chip">{value} از ۵ ★ <small>({count} ارزیابی)</small></span>;
}

function PerformanceModalContent({ performance }) {
  const targetIsManager = performance.reviewType === 'developer_to_manager';
  const targetLabel = targetIsManager ? 'مدیر پروژه' : 'برنامه‌نویس';
  const sourceLabel = targetIsManager ? 'برنامه‌نویس' : 'مدیر پروژه';

  return (
    <div className="performance-modal-layout">
      <div className="confidential-admin-banner">
        <strong>محرمانه؛ فقط ادمین</strong>
        <span>این امتیازها و نظرها برای {targetLabel} و {sourceLabel} نمایش داده نمی‌شوند.</span>
      </div>

      <section className="performance-hero">
        <div className="performance-hero-copy">
          <span className="performance-kicker">خلاصه عملکرد محرمانه</span>
          <h3>نمای کلی امتیاز {targetLabel}</h3>
          <p>
            این میانگین بر اساس ارزیابی‌های محرمانه ثبت‌شده روی تسک‌های تأییدشده محاسبه می‌شود.
            متن نظر و جزئیات هر معیار فقط در همین پنل ادمین قابل مشاهده است.
          </p>
          <div className="performance-stat-strip">
            <div>
              <strong>{performance.summary.averageScore ?? '—'}</strong>
              <span>میانگین کل</span>
            </div>
            <div>
              <strong>{performance.summary.totalReviews}</strong>
              <span>تعداد ارزیابی</span>
            </div>
          </div>
        </div>
        <div className="performance-score-card">
          <strong>{performance.summary.averageScore ?? '—'}</strong>
          <span>از ۵</span>
        </div>
      </section>

      <section className="performance-section">
        <div className="detail-section-head">
          <h3>میانگین معیارها</h3>
          <span>{performance.summary.criteria.length} معیار</span>
        </div>
        <div className="performance-criteria-grid">
          {performance.summary.criteria.map((item) => (
            <article className="performance-criterion-card" key={item.key}>
              <div className="performance-criterion-head">
                <div>
                  <strong>{item.label}</strong>
                  <small>
                    {item.average === null
                      ? 'هنوز برای این معیار امتیازی ثبت نشده است.'
                      : `میانگین این معیار ${item.average} از ۵ است.`}
                  </small>
                </div>
                <b>{item.average ?? '—'}</b>
              </div>
              <div className="rating-progress performance-progress">
                <div className="rating-progress-track">
                  <i style={{ width: `${((item.average || 0) / 5) * 100}%` }} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="performance-section">
        <div className="detail-section-head">
          <h3>جزئیات نظرها و امتیازها</h3>
          <span>{performance.recent.length} مورد</span>
        </div>
        {performance.recent.length ? (
          <div className="performance-recent-grid">
            {performance.recent.map((item) => (
              <article className="performance-review-card" key={`${item.task_id}-${item.created_at}`}>
                <div className="performance-review-top">
                  <div>
                    <strong>{item.task_title}</strong>
                    <span>{item.project_name}</span>
                  </div>
                  <div className="performance-review-score">
                    <b>{item.average_score}</b>
                    <small>از ۵</small>
                  </div>
                </div>

                <div className="performance-review-meta">
                  <span>ثبت محرمانه توسط {item.reviewer_name}</span>
                  <span>{formatDate(item.created_at, true)}</span>
                </div>

                <div className="performance-review-criteria">
                  {item.criteria.map((criterion) => (
                    <div key={criterion.key}>
                      <span>{criterion.label}</span>
                      <b>{criterion.score} / ۵</b>
                    </div>
                  ))}
                </div>

                {item.summary_note ? <p className="performance-review-note"><strong>نظر محرمانه:</strong> {item.summary_note}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="ارزیابی‌ای ثبت نشده" text={`هنوز ارزیابی محرمانه‌ای برای این ${targetLabel} ثبت نشده است.`} />
        )}
      </section>
    </div>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [modalMode, setModalMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [performanceModal, setPerformanceModal] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/users')
    .then(({ data }) => setUsers(data.users))
    .catch((error) => setToast({ message: getErrorMessage(error), tone: 'danger' }))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const filteredUsers = useMemo(() => users.filter((item) => {
    const matchRole = !roleFilter || item.role === roleFilter;
    const needle = search.trim().toLowerCase();
    const matchSearch = !needle || [item.full_name, item.username, item.email]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
    return matchRole && matchSearch;
  }), [users, search, roleFilter]);

  const openCreate = () => {
    setForm(initialForm);
    setEditingId(null);
    setModalMode('create');
  };

  const openEdit = (target) => {
    setForm({
      fullName: target.full_name,
      username: target.username,
      email: target.email || '',
      password: '',
      role: target.role,
      managerAccess: Boolean(target.manager_access),
      adminAccess: Boolean(target.admin_access),
      taskAssignmentAccess: Boolean(target.task_assignment_access),
    });
    setEditingId(target.id);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingId(null);
    setForm(initialForm);
  };

  const openPerformance = async (target) => {
    setPerformanceModal(target);
    setPerformance(null);
    setPerformanceLoading(true);
    try {
      const { data } = await api.get(`/users/${target.id}/performance`);
      setPerformance(data);
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
      setPerformanceModal(null);
    } finally {
      setPerformanceLoading(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const managerAccess = form.role === 'project_manager' ? true : Boolean(form.managerAccess);
      const adminAccess = form.role === 'admin' ? true : Boolean(form.adminAccess);
      const taskAssignmentAccess = ['admin', 'project_manager'].includes(form.role) ? true : Boolean(form.taskAssignmentAccess);
      let response;
      if (modalMode === 'create') {
        response = await api.post('/users', {
          ...form,
          username: form.username.trim().replace(/\s+/g, '_'),
          managerAccess,
          adminAccess,
          taskAssignmentAccess,
        });
      } else {
        const payload = {
          fullName: form.fullName,
          email: form.email || null,
          role: form.role,
          managerAccess,
          adminAccess,
          taskAssignmentAccess,
        };
        if (form.password) payload.password = form.password;
        response = await api.patch(`/users/${editingId}`, payload);
      }
      setToast({ message: response.data.message });
      closeModal();
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (target) => {
    try {
      const { data } = await api.patch(`/users/${target.id}`, { isActive: !Boolean(target.is_active) });
      setToast({ message: data.message });
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const toggleAccess = async (target, access) => {
    const payload = access === 'manager'
      ? { managerAccess: !Boolean(target.manager_access) }
      : access === 'task'
        ? { taskAssignmentAccess: !Boolean(target.task_assignment_access) }
        : { adminAccess: !Boolean(target.admin_access) };
    try {
      const { data } = await api.patch(`/users/${target.id}`, payload);
      setToast({ message: data.message });
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const removeUser = async (target) => {
    const accepted = window.confirm(
      `کاربر «${target.full_name}» حذف شود؟\n\nعضویت او از همه پروژه‌ها حذف می‌شود، تسک‌های اختصاص‌داده‌شده بدون مسئول می‌شوند و این عملیات قابل بازگشت نیست.`,
    );
    if (!accepted) return;
    try {
      const { data } = await api.delete(`/users/${target.id}`);
      setToast({ message: data.message });
      await load();
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    }
  };

  const changeRole = (role) => {
    setForm((current) => ({
      ...current,
      role,
      managerAccess: role === 'project_manager' ? true : current.managerAccess,
      adminAccess: role === 'admin' ? true : current.adminAccess,
      taskAssignmentAccess: ['admin', 'project_manager'].includes(role) ? true : current.taskAssignmentAccess,
    }));
  };

  return (
    <>
      <PageHeader
        title="مدیریت کاربران"
        subtitle="نقش اصلی، دسترسی فضای مدیر پروژه و دسترسی پنل ادمین را برای هر حساب مستقل تعیین کنید"
        action={<button className="button button-primary" onClick={openCreate}>+ کاربر جدید</button>}
      />

      <div className="filters-bar">
        <input
          className="filter-search"
          placeholder="جست‌وجوی نام، نام کاربری یا ایمیل…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="">همه نقش‌ها</option>
          <option value="admin">ادمین</option>
          <option value="project_manager">مدیر پروژه</option>
          <option value="developer">برنامه‌نویس</option>
        </select>
        <span>{filteredUsers.length} کاربر</span>
      </div>

      <section className="panel table-panel users-access-panel">
        {loading ? <div className="screen-center small"><div className="spinner" /></div> : filteredUsers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کاربر</th>
                  <th>نقش اصلی</th>
                  <th>دسترسی‌های تکمیلی</th>
                  <th>وضعیت</th>
                  <th>امتیاز محرمانه</th>
                  <th>آخرین ورود</th>
                  <th>تاریخ ایجاد</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((target) => {
                  const managerPrimary = target.role === 'project_manager';
                  const adminPrimary = target.role === 'admin';
                  return (
                    <tr key={target.id}>
                      <td>
                        <div className="user-cell">
                          <div className="avatar small">{target.full_name.slice(0, 1)}</div>
                          <div><strong>{target.full_name}</strong><span>{target.email || `@${target.username}`}</span></div>
                        </div>
                      </td>
                      <td><RoleLabel role={target.role} /></td>
                      <td>
                        <div className="user-access-stack">
                          <button
                            type="button"
                            disabled={managerPrimary}
                            className={`access-pill manager ${target.manager_access ? 'is-active' : ''} ${managerPrimary ? 'is-primary' : ''}`}
                            onClick={() => !managerPrimary && toggleAccess(target, 'manager')}
                            title="اجازه ورود به فضای مدیر پروژه و مشاهده گزارش پروژه‌های تحت مدیریت"
                          >
                            <span className="access-pill-dot" />
                            {managerPrimary ? 'مدیر پروژه · نقش اصلی' : target.manager_access ? 'فضای مدیر فعال' : 'فضای مدیر غیرفعال'}
                          </button>
                          <button
                            type="button"
                            disabled={adminPrimary}
                            className={`access-pill admin ${target.admin_access ? 'is-active' : ''} ${adminPrimary ? 'is-primary' : ''}`}
                            onClick={() => !adminPrimary && toggleAccess(target, 'admin')}
                            title="اجازه سوییچ به پنل مدیریت سامانه"
                          >
                            <span className="access-pill-dot" />
                            {adminPrimary ? 'ادمین · نقش اصلی' : target.admin_access ? 'پنل ادمین فعال' : 'پنل ادمین غیرفعال'}
                          </button>
                          <button
                            type="button"
                            disabled={['admin', 'project_manager'].includes(target.role)}
                            className={`access-pill task ${target.task_assignment_access ? 'is-active' : ''} ${['admin', 'project_manager'].includes(target.role) ? 'is-primary' : ''}`}
                            onClick={() => !['admin', 'project_manager'].includes(target.role) && toggleAccess(target, 'task')}
                            title="اجازه ساخت، ویرایش، حذف و تخصیص تسک بین اعضای پروژه"
                          >
                            <span className="access-pill-dot" />
                            {['admin', 'project_manager'].includes(target.role) ? 'تخصیص تسک · نقش اصلی' : target.task_assignment_access ? 'تخصیص تسک فعال' : 'تخصیص تسک غیرفعال'}
                          </button>
                        </div>
                      </td>
                      <td><span className={`status-dot-label ${target.is_active ? 'active' : 'inactive'}`}><i />{target.is_active ? 'فعال' : 'غیرفعال'}</span></td>
                      <td>{['developer', 'project_manager'].includes(target.role) ? <ScoreBadge value={target.performance_score} count={target.reviews_count} /> : <span className="muted-text">—</span>}</td>
                      <td>{formatDate(target.last_login_at, true)}</td>
                      <td>{formatDate(target.created_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="button button-small button-ghost" onClick={() => openEdit(target)}>ویرایش</button>
                          {['developer', 'project_manager'].includes(target.role) && <button className="button button-small button-ghost" onClick={() => openPerformance(target)}>ارزیابی‌های محرمانه</button>}
                          <button className={`button button-small ${target.is_active ? 'button-ghost-danger' : 'button-ghost'}`} onClick={() => toggle(target)}>{target.is_active ? 'غیرفعال‌کردن' : 'فعال‌کردن'}</button>
                          {Number(target.id) !== Number(currentUser?.id) && <button className="button button-small button-danger" onClick={() => removeUser(target)}>حذف</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="کاربری پیدا نشد" text="عبارت جست‌وجو یا فیلتر نقش را تغییر دهید." />}
      </section>

      {modalMode && (
        <Modal title={modalMode === 'create' ? 'ایجاد کاربر جدید' : 'ویرایش حساب کاربری'} wide onClose={closeModal}>
          <form className="form-grid user-editor-form" onSubmit={save}>
            <label>نام کامل<input required minLength="2" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
            <label>نام کاربری<input required minLength="3" disabled={modalMode === 'edit'} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label>ایمیل<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>{modalMode === 'create' ? 'رمز عبور عددی' : 'رمز عبور عددی جدید (اختیاری)'}<input required={modalMode === 'create'} minLength="8" maxLength="20" inputMode="numeric" pattern="[0-9]{8,20}" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>

            <label className="full">نقش اصلی
              <select value={form.role} onChange={(event) => changeRole(event.target.value)}>
                <option value="developer">برنامه‌نویس</option>
                <option value="project_manager">مدیر پروژه</option>
                <option value="admin">ادمین</option>
              </select>
            </label>

            <div className="full access-editor-section">
              <div className="access-editor-heading">
                <div><strong>دسترسی‌های تکمیلی</strong><span>بدون تغییر نقش اصلی، فضای کاری اضافه برای این حساب فعال کنید.</span></div>
              </div>
              <div className="access-editor-grid">
                <label className={`access-editor-card ${form.managerAccess || form.role === 'project_manager' ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={form.role === 'project_manager' || Boolean(form.managerAccess)}
                    disabled={form.role === 'project_manager'}
                    onChange={(event) => setForm({ ...form, managerAccess: event.target.checked })}
                  />
                  <span className="access-editor-icon">M</span>
                  <span><strong>فضای مدیر پروژه</strong><small>کاربر می‌تواند به نقش مدیر پروژه سوییچ کند، پروژه مدیریت کند و گزارش روزانه اعضای پروژه‌های خودش را ببیند.</small></span>
                </label>
                <label className={`access-editor-card ${form.adminAccess || form.role === 'admin' ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={form.role === 'admin' || Boolean(form.adminAccess)}
                    disabled={form.role === 'admin'}
                    onChange={(event) => setForm({ ...form, adminAccess: event.target.checked })}
                  />
                  <span className="access-editor-icon">A</span>
                  <span><strong>پنل ادمین</strong><small>کاربر می‌تواند از پنل کاربری به فضای ادمین سوییچ کند و به امکانات مدیریتی سامانه دسترسی داشته باشد.</small></span>
                </label>
                <label className={`access-editor-card ${form.taskAssignmentAccess || ['admin', 'project_manager'].includes(form.role) ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={['admin', 'project_manager'].includes(form.role) || Boolean(form.taskAssignmentAccess)}
                    disabled={['admin', 'project_manager'].includes(form.role)}
                    onChange={(event) => setForm({ ...form, taskAssignmentAccess: event.target.checked })}
                  />
                  <span className="access-editor-icon">T</span>
                  <span><strong>مدیریت و تخصیص تسک</strong><small>کاربر می‌تواند در پروژه‌هایی که عضو آن است، برای اعضای تیم تسک بسازد، مسئول را تغییر دهد، ویرایش و حذف کند.</small></span>
                </label>
              </div>
            </div>

            <div className="modal-actions full">
              <button type="button" className="button button-ghost" onClick={closeModal}>انصراف</button>
              <button className="button button-primary" disabled={saving}>{saving ? 'در حال ذخیره…' : modalMode === 'create' ? 'ایجاد کاربر' : 'ذخیره تغییرات'}</button>
            </div>
          </form>
        </Modal>
      )}

      {performanceModal && (
        <Modal title={`ارزیابی‌های محرمانه ${performanceModal.full_name}`} wide onClose={() => setPerformanceModal(null)}>
          {performanceLoading ? <div className="screen-center small"><div className="spinner" /></div> : performance ? <PerformanceModalContent performance={performance} /> : null}
        </Modal>
      )}
      <Toast {...toast} onClose={() => setToast(null)} />
    </>
  );
}
