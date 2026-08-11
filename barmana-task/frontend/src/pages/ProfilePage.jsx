import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, RoleLabel, Toast } from '../components/UI.jsx';

export default function ProfilePage() {
  const { user, switchRole } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', repeatPassword: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [switchingRole, setSwitchingRole] = useState(false);


  const availableRoles = Array.isArray(user.available_roles) && user.available_roles.length
    ? user.available_roles
    : [user.role];
  const canSwitchRole = availableRoles.length > 1;

  const changeActiveRole = async (activeRole) => {
    if (activeRole === user.role || switchingRole) return;
    setSwitchingRole(true);
    try {
      await switchRole(activeRole);
      navigate('/', { replace: true });
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSwitchingRole(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword !== form.repeatPassword) {
      setToast({ message: 'تکرار رمز عبور با رمز جدید یکسان نیست.', tone: 'danger' });
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setToast({ message: data.message });
      setForm({ currentPassword: '', newPassword: '', repeatPassword: '' });
    } catch (error) {
      setToast({ message: getErrorMessage(error), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="حساب کاربری" subtitle="مشاهده اطلاعات حساب و تغییر رمز عبور" />
      <div className="profile-grid">
        <section className="panel profile-card">
          <div className="avatar profile-avatar">{user.full_name?.slice(0, 1)}</div>
          <h2>{user.full_name}</h2>
          <p><RoleLabel role={user.role} /></p>
          <dl>
            <div><dt>نام کاربری</dt><dd dir="ltr">@{user.username}</dd></div>
            <div><dt>ایمیل</dt><dd>{user.email || 'ثبت نشده'}</dd></div>
          </dl>
          {canSwitchRole && (
            <div className="role-switch-card">
              <div>
                <strong>تغییر فضای کاری</strong>
                <span>نقش فعال را انتخاب کنید. تغییر نقش در رویدادهای سامانه ثبت می‌شود.</span>
              </div>
              <div className="role-switch-control" role="group" aria-label="تغییر نقش فعال">
                {availableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={user.role === role ? 'is-active' : ''}
                    disabled={switchingRole}
                    onClick={() => changeActiveRole(role)}
                  >
                    <RoleLabel role={role} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {user.role !== 'admin' && <div className="confidential-review-notice"><strong>ارزیابی‌ها محرمانه هستند</strong><p>امتیازها و نظرهای ثبت‌شده فقط در پنل ادمین قابل مشاهده‌اند.</p></div>}
        </section>
        <section className="panel profile-password">
          <div className="panel-header"><div><h3>تغییر رمز عبور</h3><p>رمز جدید فقط عدد و بین ۸ تا ۲۰ رقم باشد؛ برای کد ملی ۱۰ رقمی نیز قابل استفاده است.</p></div></div>
          <form className="form-grid" onSubmit={submit}>
            <label className="full">رمز عبور فعلی<input required type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} autoComplete="current-password" /></label>
            <label>رمز عبور جدید<input required minLength="8" maxLength="20" inputMode="numeric" pattern="[0-9]{8,20}" type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} autoComplete="new-password" /></label>
            <label>تکرار رمز جدید<input required minLength="8" maxLength="20" inputMode="numeric" pattern="[0-9]{8,20}" type="password" value={form.repeatPassword} onChange={(event) => setForm({ ...form, repeatPassword: event.target.value })} autoComplete="new-password" /></label>
            <div className="modal-actions full"><button className="button button-primary" disabled={saving}>{saving ? 'در حال ذخیره…' : 'تغییر رمز عبور'}</button></div>
          </form>
        </section>
      </div>
      <Toast {...toast} onClose={() => setToast(null)} />
    </>
  );
}
