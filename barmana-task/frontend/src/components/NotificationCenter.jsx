import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { formatDate } from './UI.jsx';

export default function NotificationCenter() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = () => api.get('/notifications?limit=30').then(({ data }) => {
    setItems(data.notifications);
    setUnread(data.unread);
  }).catch(() => {});

  useEffect(() => {
    load();
    const interval = setInterval(load, 45000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openItem = async (item) => {
    if (!item.is_read) {
      await api.patch(`/notifications/${item.id}/read`).catch(() => {});
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_read: 1 } : row));
      setUnread((value) => Math.max(0, value - 1));
    }
    setOpen(false);
    if (item.entity_type === 'task') navigate(`/tasks?task=${item.entity_id}`);
    else if (item.entity_type === 'project') navigate('/projects');
  };

  const readAll = async () => {
    await api.patch('/notifications/read-all').catch(() => {});
    setItems((current) => current.map((item) => ({ ...item, is_read: 1 })));
    setUnread(0);
  };

  return (
    <div className="notification-center" ref={rootRef}>
      <button type="button" className="notification-button" onClick={() => { setOpen((value) => !value); if (!open) load(); }} aria-label="اعلان‌ها">
        <span>♢</span>{unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="notification-head"><div><strong>اعلان‌ها</strong><span>{unread} خوانده‌نشده</span></div>{unread > 0 && <button type="button" onClick={readAll}>خواندن همه</button>}</div>
          <div className="notification-list">
            {items.length ? items.map((item) => (
              <button type="button" key={item.id} className={`notification-item ${item.is_read ? '' : 'unread'}`} onClick={() => openItem(item)}>
                <i />
                <span><strong>{item.title}</strong><p>{item.message}</p><small>{formatDate(item.created_at, true)}</small></span>
              </button>
            )) : <div className="notification-empty">اعلان جدیدی ندارید.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
