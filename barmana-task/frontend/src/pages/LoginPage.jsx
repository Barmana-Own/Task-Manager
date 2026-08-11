import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import BrandLogo from '../components/BrandLogo.jsx';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError(''); setSubmitting(true);
    try { await login(form.username, form.password); navigate('/'); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-brand"><BrandLogo subtitle="مرکز کنترل پروژه‌ها و فعالیت‌های تیم فنی" /></div>
        <div className="login-copy">
          <span className="eyebrow">عملیات شفاف، تحویل دقیق</span>
          <h2>از تعریف تسک تا تأیید نهایی، همه‌چیز در یک جریان مشخص.</h2>
          <p>پروژه‌ها را سازمان‌دهی کنید، مسئولیت‌ها را شفاف بسازید و زمان واقعی صرف‌شده را ببینید.</p>
          <div className="feature-pills"><span>سه نقش مستقل</span><span>تایمر زنده</span><span>بازبینی مدیر</span></div>
        </div>
      </div>
      <div className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <div><span className="eyebrow">ورود امن</span><h2>خوش آمدید</h2><p>برای ورود، اطلاعات حساب خود را وارد کنید.</p></div>
          {error && <div className="alert alert-danger">{error}</div>}
          <label>نام کاربری<input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" /></label>
          <label>رمز عبور<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" /></label>
          <button className="button button-primary button-block" disabled={submitting}>{submitting ? 'در حال ورود…' : 'ورود به سامانه'}</button>
        </form>
      </div>
    </div>
  );
}
