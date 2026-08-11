import { Router } from 'express';
import { body, query } from 'express-validator';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);

router.get('/active', asyncHandler(async (req, res) => {
  const conditions = ['ts.ended_at IS NULL'];
  const params = [];
  if (['developer', 'project_manager'].includes(req.user.role)) {
    conditions.push('ts.user_id = ?');
    params.push(req.user.id);
  }
  const [rows] = await pool.execute(
    `SELECT ts.*, t.title AS task_title, p.name AS project_name, u.full_name AS user_name,
      TIMESTAMPDIFF(SECOND, ts.started_at, NOW()) AS live_seconds
     FROM timer_sessions ts
     JOIN tasks t ON t.id = ts.task_id
     JOIN projects p ON p.id = t.project_id
     JOIN users u ON u.id = ts.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ts.started_at DESC`,
    params,
  );
  res.json({ timers: rows });
}));

router.get(
  '/logs',
  [
    query('taskId').optional().isInt({ min: 1 }).withMessage('تسک معتبر نیست.'),
    query('projectId').isInt({ min: 1 }).withMessage('برای مشاهده ریز زمان‌ها انتخاب پروژه الزامی است.'),
    query('userId').optional().isInt({ min: 1 }).withMessage('کاربر معتبر نیست.'),
    query('dateFrom').optional().isISO8601().withMessage('تاریخ شروع معتبر نیست.'),
    query('dateTo').optional().isISO8601().withMessage('تاریخ پایان معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const conditions = [];
    const params = [];
    if (req.user.role === 'developer') {
      conditions.push('ts.user_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'project_manager') {
      conditions.push('p.manager_id = ?');
      params.push(req.user.id);
    }
    if (req.query.taskId) {
      conditions.push('ts.task_id = ?');
      params.push(Number(req.query.taskId));
    }
    if (req.query.projectId) {
      conditions.push('t.project_id = ?');
      params.push(Number(req.query.projectId));
    }
    if (req.query.userId && req.user.role !== 'developer') {
      conditions.push('ts.user_id = ?');
      params.push(Number(req.query.userId));
    }
    if (req.query.dateFrom) {
      conditions.push('DATE(ts.started_at) >= ?');
      params.push(req.query.dateFrom);
    }
    if (req.query.dateTo) {
      conditions.push('DATE(ts.started_at) <= ?');
      params.push(req.query.dateTo);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT ts.*, t.title AS task_title, p.id AS project_id, p.name AS project_name,
        u.full_name AS user_name,
        CASE WHEN ts.ended_at IS NULL THEN TIMESTAMPDIFF(SECOND, ts.started_at, NOW()) ELSE ts.duration_seconds END AS effective_seconds
       FROM timer_sessions ts
       JOIN tasks t ON t.id = ts.task_id
       JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = ts.user_id
       ${where}
       ORDER BY ts.started_at DESC LIMIT 1000`,
      params,
    );
    res.json({ logs: rows });
  }),
);

router.post(
  '/start',
  authorize('developer', 'project_manager'),
  [body('taskId').isInt({ min: 1 }).withMessage('تسک معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.body.taskId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [tasks] = await connection.execute(
        `SELECT t.id, t.status, t.assignee_id, p.status AS project_status
         FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? FOR UPDATE`,
        [taskId],
      );
      const task = tasks[0];
      if (!task || Number(task.assignee_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'این تسک به شما اختصاص ندارد.' });
      }
      if (['completed', 'archived'].includes(task.project_status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'پروژه بسته است و تایمر جدید نمی‌پذیرد.' });
      }
      if (['review', 'done'].includes(task.status)) {
        await connection.rollback();
        return res.status(400).json({ message: 'برای این وضعیت نمی‌توان تایمر را شروع کرد.' });
      }
      const [active] = await connection.execute('SELECT id, task_id FROM timer_sessions WHERE user_id = ? AND ended_at IS NULL FOR UPDATE', [req.user.id]);
      if (active[0]) {
        await connection.rollback();
        return res.status(409).json({ message: 'یک تایمر دیگر فعال است. ابتدا آن را متوقف کنید.', activeTimer: active[0] });
      }
      const [result] = await connection.execute('INSERT INTO timer_sessions (task_id, user_id, active_user_id, started_at) VALUES (?, ?, ?, NOW())', [taskId, req.user.id, req.user.id]);
      await connection.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ? AND status IN ('todo', 'changes_requested')", [taskId]);
      await audit({ userId: req.user.id, entityType: 'timer', entityId: result.insertId, action: 'start', metadata: { taskId }, connection });
      await connection.commit();
      res.status(201).json({ message: 'تایمر شروع شد.', id: result.insertId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.post(
  '/stop',
  authorize('developer', 'project_manager'),
  [body('note').optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 500 }).withMessage('یادداشت معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [active] = await connection.execute('SELECT id, task_id FROM timer_sessions WHERE user_id = ? AND ended_at IS NULL FOR UPDATE', [req.user.id]);
      const timer = active[0];
      if (!timer) {
        await connection.rollback();
        return res.status(404).json({ message: 'تایمر فعالی پیدا نشد.' });
      }
      await connection.execute(
        `UPDATE timer_sessions
         SET ended_at = NOW(), active_user_id = NULL, duration_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW()), note = ?
         WHERE id = ?`,
        [req.body.note || null, timer.id],
      );
      await audit({ userId: req.user.id, entityType: 'timer', entityId: timer.id, action: 'stop', metadata: { taskId: timer.task_id }, connection });
      await connection.commit();
      res.json({ message: 'تایمر متوقف و زمان ثبت شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

export default router;
