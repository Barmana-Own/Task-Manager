import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from '../config/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function utcDay(value) {
  const text = dateOnly(value);
  if (!text) return null;
  const [year, month, day] = text.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function dayDiff(later, earlier) {
  const a = utcDay(later);
  const b = utcDay(earlier);
  if (a === null || b === null) return 0;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function taskWeight(task) {
  const estimated = Number(task.estimated_minutes || 0);
  return estimated > 0 ? estimated : 60;
}

function taskActualRatio(task, reportDate) {
  if (task.status === 'done' && dateOnly(task.completed_at) && utcDay(task.completed_at) <= utcDay(reportDate)) return 1;
  const total = Number(task.checklist_total || 0);
  const completed = Number(task.checklist_completed || 0);
  if (total > 0) return clamp(completed / total, 0, 1);
  if (task.status === 'review') return 0.9;
  if (['in_progress', 'changes_requested'].includes(task.status)) return 0.5;
  return 0;
}

export async function assertProjectProgressAccess({ projectId, user, connection = pool }) {
  const [rows] = await connection.execute(
    `SELECT p.*, u.full_name AS manager_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.manager_id
     WHERE p.id = ? LIMIT 1`,
    [projectId],
  );
  const project = rows[0];
  if (!project) return { project: null, allowed: false };
  if (!user) return { project, allowed: true };
  const allowed = user.role === 'admin'
    || (user.role === 'project_manager' && Number(project.manager_id) === Number(user.id));
  return { project, allowed };
}

function calculatePlannedProgress(project, tasks, reportDate) {
  const start = dateOnly(project.start_date);
  const target = dateOnly(project.target_date);
  if (start && target) {
    const totalDays = Math.max(1, dayDiff(target, start));
    const passed = dayDiff(reportDate, start);
    if (utcDay(reportDate) < utcDay(start)) return { percent: 0, method: 'project_schedule' };
    if (utcDay(reportDate) >= utcDay(target)) return { percent: 100, method: 'project_schedule' };
    return { percent: round2(clamp((passed / totalDays) * 100)), method: 'project_schedule' };
  }

  const scheduled = tasks.filter((task) => dateOnly(task.due_date));
  if (scheduled.length) {
    const totalWeight = tasks.reduce((sum, task) => sum + taskWeight(task), 0) || 1;
    const plannedWeight = tasks.reduce((sum, task) => {
      const due = dateOnly(task.due_date);
      return due && utcDay(due) <= utcDay(reportDate) ? sum + taskWeight(task) : sum;
    }, 0);
    return { percent: round2(clamp((plannedWeight / totalWeight) * 100)), method: 'task_due_dates' };
  }

  return { percent: 0, method: 'no_schedule' };
}

export async function buildProjectProgressSnapshot({ projectId, reportDate, user = null, connection = pool }) {
  const normalizedDate = dateOnly(reportDate) || new Date().toISOString().slice(0, 10);
  const { project, allowed } = await assertProjectProgressAccess({ projectId, user, connection });
  if (!project) return { notFound: true };
  if (!allowed) return { forbidden: true };

  const [[taskRows], [timeRows], [dailyRows], [taskDailyRows], [savedRows]] = await Promise.all([
    connection.execute(
      `SELECT t.id, t.sequence_no, t.title, t.status, t.priority, t.due_date, t.estimated_minutes,
        t.completed_at, t.created_at, a.full_name AS assignee_name, sec.title AS section_title,
        COALESCE(cl.checklist_total, 0) AS checklist_total,
        COALESCE(cl.checklist_completed, 0) AS checklist_completed
       FROM tasks t
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN project_sections sec ON sec.id = t.section_id
       LEFT JOIN (
         SELECT task_id, COUNT(*) AS checklist_total, SUM(is_completed = 1) AS checklist_completed
         FROM task_checklist_items GROUP BY task_id
       ) cl ON cl.task_id = t.id
       WHERE t.project_id = ? AND DATE(t.created_at) <= ?
       ORDER BY t.sequence_no ASC`,
      [projectId, normalizedDate],
    ),
    connection.execute(
      `SELECT COALESCE(SUM(CASE
          WHEN ts.ended_at IS NULL THEN TIMESTAMPDIFF(SECOND, ts.started_at, NOW())
          ELSE ts.duration_seconds END), 0) AS tracked_seconds
       FROM timer_sessions ts
       JOIN tasks t ON t.id = ts.task_id
       WHERE t.project_id = ? AND DATE(ts.started_at) = ?`,
      [projectId, normalizedDate],
    ),
    connection.execute(
      `SELECT r.user_id, r.summary, r.blockers, r.next_plan, u.full_name AS user_name
       FROM daily_reports r
       JOIN users u ON u.id = r.user_id
       WHERE r.project_id = ? AND r.report_date = ?
       ORDER BY u.full_name`,
      [projectId, normalizedDate],
    ),
    connection.execute(
      `SELECT tr.task_id, tr.body, u.full_name AS user_name, t.sequence_no, t.title AS task_title
       FROM task_daily_reports tr
       JOIN tasks t ON t.id = tr.task_id
       JOIN users u ON u.id = tr.user_id
       WHERE t.project_id = ? AND tr.report_date = ?
       ORDER BY t.sequence_no, u.full_name`,
      [projectId, normalizedDate],
    ),
    connection.execute(
      `SELECT * FROM project_daily_progress_reports
       WHERE project_id = ? AND report_date = ? LIMIT 1`,
      [projectId, normalizedDate],
    ),
  ]);

  const tasks = taskRows;
  const totalWeight = tasks.reduce((sum, task) => sum + taskWeight(task), 0) || 1;
  const doneTasks = tasks.filter((task) => task.status === 'done' && dateOnly(task.completed_at) && utcDay(task.completed_at) <= utcDay(normalizedDate));
  const actualWeight = tasks.reduce((sum, task) => sum + (taskWeight(task) * taskActualRatio(task, normalizedDate)), 0);
  const actualProgress = tasks.length ? round2(clamp((actualWeight / totalWeight) * 100)) : 0;
  const planned = calculatePlannedProgress(project, tasks, normalizedDate);

  const overdueList = tasks
    .filter((task) => {
      const due = dateOnly(task.due_date);
      const completedByDate = task.status === 'done' && dateOnly(task.completed_at) && utcDay(task.completed_at) <= utcDay(normalizedDate);
      return due && utcDay(due) < utcDay(normalizedDate) && !completedByDate;
    })
    .map((task) => ({
      id: task.id,
      sequenceNo: Number(task.sequence_no),
      title: task.title,
      assigneeName: task.assignee_name || 'بدون مسئول',
      dueDate: dateOnly(task.due_date),
      delayDays: dayDiff(normalizedDate, task.due_date),
      sectionTitle: task.section_title || null,
    }));

  const completedLateList = tasks
    .filter((task) => task.status === 'done' && dateOnly(task.due_date) && dateOnly(task.completed_at)
      && utcDay(task.completed_at) > utcDay(task.due_date) && utcDay(task.completed_at) <= utcDay(normalizedDate))
    .map((task) => ({
      id: task.id,
      sequenceNo: Number(task.sequence_no),
      title: task.title,
      assigneeName: task.assignee_name || 'بدون مسئول',
      dueDate: dateOnly(task.due_date),
      completedDate: dateOnly(task.completed_at),
      delayDays: dayDiff(task.completed_at, task.due_date),
      sectionTitle: task.section_title || null,
    }));

  const saved = savedRows[0] || null;
  return {
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      managerId: project.manager_id,
      managerName: project.manager_name,
      startDate: dateOnly(project.start_date),
      targetDate: dateOnly(project.target_date),
      status: project.status,
    },
    reportDate: normalizedDate,
    plannedProgress: planned.percent,
    plannedMethod: planned.method,
    actualProgress,
    varianceProgress: round2(actualProgress - planned.percent),
    totalTasks: tasks.length,
    doneTasks: doneTasks.length,
    inProgressTasks: tasks.filter((task) => ['in_progress', 'review', 'changes_requested'].includes(task.status)).length,
    overdueTasks: overdueList.length,
    completedLateTasks: completedLateList.length,
    delayDays: [...overdueList, ...completedLateList].reduce((sum, task) => sum + task.delayDays, 0),
    trackedSeconds: Number(timeRows[0]?.tracked_seconds || 0),
    overdueList,
    completedLateList,
    employeeReports: dailyRows,
    taskReports: taskDailyRows,
    saved: saved ? {
      id: saved.id,
      delayNote: saved.delay_note || '',
      lossAmount: saved.loss_amount === null ? '' : String(saved.loss_amount),
      lossUnit: saved.loss_unit || 'تومان',
      lossNote: saved.loss_note || '',
      managerNote: saved.manager_note || '',
      generatedAt: saved.generated_at,
    } : null,
  };
}

function formatSeconds(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} ساعت و ${minutes} دقیقه`;
}

function plannedMethodLabel(method) {
  if (method === 'project_schedule') return 'بر اساس تاریخ شروع و تاریخ هدف پروژه';
  if (method === 'task_due_dates') return 'بر اساس موعد تسک‌ها';
  return 'برنامه زمانی کافی ثبت نشده است';
}

export function buildProjectReportText(snapshot, notes = {}) {
  const lines = [];
  const varianceLabel = snapshot.varianceProgress >= 0 ? 'جلوتر/مطابق برنامه' : 'عقب‌تر از برنامه';
  lines.push('گزارش پایان روز پروژه');
  lines.push('='.repeat(68));
  lines.push(`پروژه: ${snapshot.project.name}`);
  lines.push(`کد پروژه: ${snapshot.project.code}`);
  lines.push(`مدیر پروژه: ${snapshot.project.managerName || '—'}`);
  lines.push(`تاریخ گزارش: ${snapshot.reportDate}`);
  lines.push('');
  lines.push('وضعیت پیشرفت');
  lines.push('-'.repeat(68));
  lines.push(`پیشرفت برنامه‌ای: ${snapshot.plannedProgress}% (${plannedMethodLabel(snapshot.plannedMethod)})`);
  lines.push(`پیشرفت واقعی: ${snapshot.actualProgress}%`);
  lines.push(`انحراف از برنامه: ${snapshot.varianceProgress}% (${varianceLabel})`);
  lines.push(`تعداد کل تسک‌ها: ${snapshot.totalTasks}`);
  lines.push(`تسک‌های تکمیل‌شده: ${snapshot.doneTasks}`);
  lines.push(`تسک‌های در جریان: ${snapshot.inProgressTasks}`);
  lines.push(`زمان ثبت‌شده امروز: ${formatSeconds(snapshot.trackedSeconds)}`);
  lines.push('');
  lines.push('تاخیرات');
  lines.push('-'.repeat(68));
  lines.push(`تعداد تسک‌های بازِ عقب‌افتاده: ${snapshot.overdueTasks}`);
  lines.push(`تعداد تسک‌های تکمیل‌شده با تاخیر: ${snapshot.completedLateTasks}`);
  lines.push(`مجموع روزهای تاخیر: ${snapshot.delayDays}`);
  if (snapshot.overdueList.length) {
    lines.push('تسک‌های بازِ عقب‌افتاده:');
    snapshot.overdueList.forEach((task) => {
      lines.push(`- #${String(task.sequenceNo).padStart(2, '0')} ${task.title} | بخش: ${task.sectionTitle || 'بدون بخش'} | مسئول: ${task.assigneeName} | مهلت: ${task.dueDate} | تاخیر: ${task.delayDays} روز`);
    });
  }
  if (snapshot.completedLateList.length) {
    lines.push('تسک‌های تکمیل‌شده با تاخیر:');
    snapshot.completedLateList.forEach((task) => {
      lines.push(`- #${String(task.sequenceNo).padStart(2, '0')} ${task.title} | مسئول: ${task.assigneeName} | مهلت: ${task.dueDate} | تکمیل: ${task.completedDate} | تاخیر: ${task.delayDays} روز`);
    });
  }
  if (!snapshot.overdueList.length && !snapshot.completedLateList.length) lines.push('- تاخیری برای این تاریخ ثبت نشده است.');
  if (notes.delayNote) lines.push(`توضیح مدیر درباره تاخیرات: ${notes.delayNote}`);
  lines.push('');
  lines.push('ضرر و زیان / اثر تاخیر');
  lines.push('-'.repeat(68));
  lines.push(`برآورد مالی: ${notes.lossAmount || '0'} ${notes.lossUnit || 'تومان'}`);
  lines.push(`شرح ضرر و زیان: ${notes.lossNote || 'موردی ثبت نشده است.'}`);
  lines.push('');
  lines.push('گزارش فعالیت اعضای پروژه');
  lines.push('-'.repeat(68));
  if (snapshot.employeeReports.length) {
    snapshot.employeeReports.forEach((report) => {
      lines.push(`${report.user_name}: ${report.summary}`);
      if (report.blockers) lines.push(`  موانع: ${report.blockers}`);
      if (report.next_plan) lines.push(`  برنامه بعدی: ${report.next_plan}`);
    });
  } else if (snapshot.taskReports.length) {
    snapshot.taskReports.forEach((report) => {
      lines.push(`${report.user_name} | #${String(report.sequence_no).padStart(2, '0')} ${report.task_title}: ${report.body}`);
    });
  } else {
    lines.push('گزارش روزانه‌ای از اعضا ثبت نشده است.');
  }
  lines.push('');
  lines.push('جمع‌بندی مدیر پروژه');
  lines.push('-'.repeat(68));
  lines.push(notes.managerNote || 'جمع‌بندی جداگانه‌ای ثبت نشده است.');
  lines.push('');
  lines.push(`زمان تولید گزارش: ${new Date().toISOString()}`);
  return lines.join('\r\n');
}

export function getProjectReportDirectory() {
  return process.env.PROJECT_REPORT_DIR || path.join(projectRoot, 'daily-project-reports');
}

function safeFilePart(value) {
  return String(value || 'project')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

export function getProjectReportFilename(snapshot) {
  return `${snapshot.reportDate}-${safeFilePart(snapshot.project.code)}-${safeFilePart(snapshot.project.name)}.txt`;
}

export async function writeProjectReportFile(snapshot, text) {
  const directory = getProjectReportDirectory();
  await fs.mkdir(directory, { recursive: true });
  const filename = getProjectReportFilename(snapshot);
  const fullPath = path.join(directory, filename);
  await fs.writeFile(fullPath, `\uFEFF${text}`, 'utf8');
  return { directory, filename, fullPath };
}
