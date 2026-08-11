import { useEffect, useMemo, useState } from 'react';

export default function ProjectPicker({ projects, value, onChange, title = 'انتخاب پروژه', hint = 'نام یا کد پروژه را جست‌وجو کنید' }) {
  const [query, setQuery] = useState('');
  const selected = projects.find((project) => String(project.id) === String(value));
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('fa');
    if (!term) return projects;
    return projects.filter((project) => `${project.name} ${project.code}`.toLocaleLowerCase('fa').includes(term));
  }, [projects, query]);

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <section className="project-context-panel">
      <div className="project-context-copy">
        <span>{title}</span>
        <strong>{selected ? selected.name : 'هنوز پروژه‌ای انتخاب نشده'}</strong>
        <small>{selected ? `${selected.code} · فقط اطلاعات همین پروژه نمایش داده می‌شود` : hint}</small>
      </div>
      <div className="project-context-controls">
        <div className="project-search-box">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={hint}
            aria-label="جست‌وجوی پروژه"
          />
          {query.trim() && (
            <div className="project-search-results">
              {filtered.length ? filtered.slice(0, 7).map((project) => (
                <button type="button" key={project.id} onClick={() => { onChange(String(project.id)); setQuery(''); }}>
                  <strong>{project.name}</strong><span>{project.code}</span>
                </button>
              )) : <p>پروژه‌ای با این عبارت پیدا نشد.</p>}
            </div>
          )}
        </div>
        <select value={value || ''} onChange={(event) => onChange(event.target.value)} aria-label="انتخاب پروژه">
          <option value="">انتخاب پروژه…</option>
          {filtered.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.code}</option>)}
        </select>
        {value && <button type="button" className="button button-small button-ghost" onClick={() => onChange('')}>تغییر پروژه</button>}
      </div>
    </section>
  );
}
