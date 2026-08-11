import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatJalaliNumeric,
  gregorianToJalali,
  isoToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  jalaliToIso,
  localTodayIso,
  toPersianDigits,
} from '../utils/jalali.js';

const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const weekdays = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

function viewFromValue(value) {
  return isoToJalali(value) || isoToJalali(localTodayIso());
}

export default function JalaliDatePicker({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ شمسی',
  min,
  max,
  required = false,
  disabled = false,
  name,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => viewFromValue(value));
  const selected = useMemo(() => isoToJalali(value), [value]);
  const today = useMemo(() => isoToJalali(localTodayIso()), []);

  useEffect(() => {
    if (value) setView(viewFromValue(value));
  }, [value]);

  useEffect(() => {
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const firstGregorian = jalaliToGregorian(view.jy, view.jm, 1);
  const firstWeekday = (new Date(firstGregorian.gy, firstGregorian.gm - 1, firstGregorian.gd).getDay() + 1) % 7;
  const monthLength = jalaliMonthLength(view.jy, view.jm);
  const cells = Array.from({ length: firstWeekday + monthLength }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);

  const changeMonth = (step) => {
    let jy = view.jy;
    let jm = view.jm + step;
    if (jm > 12) { jm = 1; jy += 1; }
    if (jm < 1) { jm = 12; jy -= 1; }
    setView({ jy, jm, jd: 1 });
  };

  const choose = (day) => {
    const iso = jalaliToIso(view.jy, view.jm, day);
    if ((min && iso < min) || (max && iso > max)) return;
    onChange?.(iso);
    setOpen(false);
  };

  const isDisabledDay = (day) => {
    const iso = jalaliToIso(view.jy, view.jm, day);
    return Boolean((min && iso < min) || (max && iso > max));
  };

  const isSelected = (day) => selected && selected.jy === view.jy && selected.jm === view.jm && selected.jd === day;
  const isToday = (day) => today && today.jy === view.jy && today.jm === view.jm && today.jd === day;

  return (
    <div className={`jalali-picker ${open ? 'is-open' : ''}`} ref={rootRef}>
      {name && <input type="hidden" name={name} value={value || ''} required={required} />}
      <button
        type="button"
        className="jalali-input"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={value ? '' : 'placeholder'} dir="ltr">{value ? formatJalaliNumeric(value) : placeholder}</span>
        <span className="jalali-calendar-icon" aria-hidden="true">▣</span>
      </button>
      {open && !disabled && (
        <div className="jalali-popover" role="dialog" aria-label="تقویم شمسی">
          <div className="jalali-head">
            <button type="button" onClick={() => changeMonth(1)} aria-label="ماه بعد">‹</button>
            <strong>{months[view.jm - 1]} {toPersianDigits(view.jy)}</strong>
            <button type="button" onClick={() => changeMonth(-1)} aria-label="ماه قبل">›</button>
          </div>
          <div className="jalali-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="jalali-days">
            {cells.map((day, index) => day === null ? <span key={`blank-${index}`} /> : (
              <button
                type="button"
                key={day}
                className={`${isSelected(day) ? 'selected' : ''} ${isToday(day) ? 'today' : ''}`}
                disabled={isDisabledDay(day)}
                onClick={() => choose(day)}
              >
                {toPersianDigits(day)}
              </button>
            ))}
          </div>
          <div className="jalali-actions">
            <button type="button" onClick={() => { onChange?.(''); setOpen(false); }}>پاک‌کردن</button>
            <button type="button" onClick={() => {
              const now = localTodayIso();
              if ((!min || now >= min) && (!max || now <= max)) onChange?.(now);
              setView(viewFromValue(now));
              setOpen(false);
            }}>امروز</button>
          </div>
        </div>
      )}
    </div>
  );
}
