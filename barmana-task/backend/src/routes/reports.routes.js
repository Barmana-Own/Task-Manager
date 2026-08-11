import { Router } from 'express';
import { body, query } from 'express-validator';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import {
  buildProjectProgressSnapshot,
  buildProjectReportText,
  writeProjectReportFile,
} from '../utils/projectProgress.js';

const router = Router();
router.use(authenticate);

function normalizeProjectReportNotes(bodyValue = {}) {
  return {
    delayNote: String(bodyValue.delayNote || '').trim(),
    lossAmount: bodyValue.lossAmount === '' || bodyValue.lossAmount === null || bodyValue.lossAmount === undefined
      ? '' : String(bodyValue.lossAmount),
    lossUnit: String(bodyValue.lossUnit || 'تومان').trim() || 'تومان',
    lossNote: String(bodyValue.lossNote || '').trim(),
    managerNote: String(bodyValue.managerNote || '').trim(),
  };
}

router.get(
  '/project-progress',
  authorize('admin', 'project_manager'),
  [
    query('projectId').isInt({ min: 1 }).withMessage('پروژه معتبر نیست.'),
    query('date').optional().isISO8601().withMessage('تاریخ گزارش معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const snapshot = await buildProjectProgressSnapshot({
      projectId: Number(req.query.projectId),
      reportDate: req.query.date,
      user: req.user,
    });
    if (snapshot.notFound) return res.status(404).json({ message: 'پروژه پیدا نشد.' });
    if (snapshot.forbidden) return res.status(403).json({ message: 'به گزارش پیشرفت این پروژه دسترسی ندارید.' });
    res.json({ report: snapshot });
  }),
);

router.post(
  '/project-progress',
  authorize('admin', 'project_manager'),
  [
    body('projectId').isInt({ min: 1 }).withMessage('پروژه معتبر نیست.'),
    body('reportDate').isISO8601().withMessage('تاریخ گزارش معتبر نیست.'),
    body('delayNote').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('توضیحات تاخیرات طولانی است.'),
    body('lossAmount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 9999999999999999 }).withMessage('مبلغ ضرر و زیان معتبر نیست.'),
    body('lossUnit').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 20 }).withMessage('واحد مبلغ معتبر نیست.'),
    body('lossNote').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('شرح ضرر و زیان طولانی است.'),
    body('managerNote').optional({ nullable: true }).trim().isLength({ max: 20000 }).withMessage('جمع‌بندی مدیر طولانی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = Number(req.body.projectId);
    const reportDate = req.body.reportDate;
    const snapshot = await buildProjectProgressSnapshot({ projectId, reportDate, user: req.user });
    if (snapshot.notFound) return res.status(404).json({ message: 'پروژه پیدا نشد.' });
    if (snapshot.forbidden) return res.status(403).json({ message: 'به گزارش پیشرفت این پروژه دسترسی ندارید.' });

    const notes = normalizeProjectReportNotes(req.body);
    const text = buildProjectReportText(snapshot, notes);
    await pool.execute(
      `INSERT INTO project_daily_progress_reports
        (project_id, report_date, planned_progress, actual_progress, variance_progress, total_tasks, done_tasks,
         in_progress_tasks, overdue_tasks, delay_days, tracked_seconds, loss_amount, loss_unit, loss_note,
         delay_note, manager_note, generated_text, created_by, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         planned_progress = VALUES(planned_progress), actual_progress = VALUES(actual_progress), variance_progress = VALUES(variance_progress),
         total_tasks = VALUES(total_tasks), done_tasks = VALUES(done_tasks), in_progress_tasks = VALUES(in_progress_tasks),
         overdue_tasks = VALUES(overdue_tasks), delay_days = VALUES(delay_days), tracked_seconds = VALUES(tracked_seconds),
         loss_amount = VALUES(loss_amount), loss_unit = VALUES(loss_unit), loss_note = VALUES(loss_note),
         delay_note = VALUES(delay_note), manager_note = VALUES(manager_note), generated_text = VALUES(generated_text),
         created_by = VALUES(created_by), generated_at = NOW()`,
      [
        projectId, reportDate, snapshot.plannedProgress, snapshot.actualProgress, snapshot.varianceProgress,
        snapshot.totalTasks, snapshot.doneTasks, snapshot.inProgressTasks, snapshot.overdueTasks, snapshot.delayDays,
        snapshot.trackedSeconds, notes.lossAmount === '' ? null : Number(notes.lossAmount), notes.lossUnit,
        notes.lossNote || null, notes.delayNote || null, notes.managerNote || null, text, req.user.id,
      ],
    );
    const file = await writeProjectReportFile(snapshot, text);
    await audit({
      userId: req.user.id,
      entityType: 'project_progress_report',
      entityId: projectId,
      action: 'generate',
      metadata: { projectId, reportDate, filename: file.filename },
    });
    const refreshed = await buildProjectProgressSnapshot({ projectId, reportDate, user: req.user });
    res.json({
      message: 'گزارش پیشرفت پروژه ذخیره و فایل متنی تولید شد.',
      report: refreshed,
      file: { filename: file.filename },
    });
  }),
);

router.get(
  '/project-progress/download',
  authorize('admin', 'project_manager'),
  [
    query('projectId').isInt({ min: 1 }).withMessage('پروژه معتبر نیست.'),
    query('date').optional().isISO8601().withMessage('تاریخ گزارش معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const snapshot = await buildProjectProgressSnapshot({
      projectId: Number(req.query.projectId),
      reportDate: req.query.date,
      user: req.user,
    });
    if (snapshot.notFound) return res.status(404).json({ message: 'پروژه پیدا نشد.' });
    if (snapshot.forbidden) return res.status(403).json({ message: 'به گزارش پیشرفت این پروژه دسترسی ندارید.' });
    const saved = snapshot.saved || {};
    const text = buildProjectReportText(snapshot, {
      delayNote: saved.delayNote || '',
      lossAmount: saved.lossAmount || '',
      lossUnit: saved.lossUnit || 'تومان',
      lossNote: saved.lossNote || '',
      managerNote: saved.managerNote || '',
    });
    const safeCode = String(snapshot.project.code || 'project').replace(/[^A-Za-z0-9_-]/g, '-');
    const filename = `${snapshot.reportDate}-${safeCode}-project-report.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${text}`);
  }),
);

router.get(
  '/',
  [
    query('projectId').optional().isInt({ min: 1 }).withMessage('پروژه معتبر نیست.'),
    query('date').optional().isISO8601().withMessage('تاریخ معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];
    if (req.user.role === 'developer') {
      conditions.push('r.user_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'project_manager') {
      conditions.push('(r.user_id = ? OR p.manager_id = ?)');
      params.push(req.user.id, req.user.id);
    }
    if (req.query.projectId) {
      conditions.push('r.project_id = ?');
      params.push(Number(req.query.projectId));
    }
    if (req.query.date) {
      conditions.push('r.report_date = ?');
      params.push(req.query.date);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT r.*, u.full_name AS user_name, u.role AS user_role, p.name AS project_name
       FROM daily_reports r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN projects p ON p.id = r.project_id
       ${where}
       ORDER BY r.report_date DESC, r.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ reports: rows });
  }),
);

router.post(
  '/',
  [
    body('projectId').isInt({ min: 1 }).withMessage('پروژه الزامی است.'),
    body('reportDate').isISO8601().withMessage('تاریخ گزارش معتبر نیست.'),
    body('summary').trim().isLength({ min: 5, max: 10000 }).withMessage('خلاصه فعالیت باید بین ۵ تا ۱۰۰۰۰ کاراکتر باشد.'),
    body('blockers').optional({ checkFalsy: true }).trim().isLength({ max: 10000 }).withMessage('متن موانع طولانی است.'),
    body('nextPlan').optional({ checkFalsy: true }).trim().isLength({ max: 10000 }).withMessage('متن برنامه بعدی طولانی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { projectId, reportDate, summary, blockers, nextPlan } = req.body;
    if (projectId) {
      let accessSql = 'SELECT id FROM projects WHERE id = ?';
      const params = [projectId];
      if (req.user.role === 'project_manager') {
        accessSql += ' AND manager_id = ?';
        params.push(req.user.id);
      } else if (req.user.role === 'developer') {
        accessSql += ' AND EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = ?)';
        params.push(req.user.id);
      }
      const [access] = await pool.execute(accessSql, params);
      if (!access[0]) return res.status(403).json({ message: 'به پروژه انتخاب‌شده دسترسی ندارید.' });
    }

    await pool.execute(
      `INSERT INTO daily_reports (user_id, project_id, report_date, summary, blockers, next_plan)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), blockers = VALUES(blockers),
         next_plan = VALUES(next_plan), updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, projectId, reportDate, summary, blockers || null, nextPlan || null],
    );
    await audit({ userId: req.user.id, entityType: 'report', action: 'upsert', metadata: { projectId, reportDate } });
    res.status(201).json({ message: 'گزارش روزانه ذخیره شد.' });
  }),
);

export default router;
