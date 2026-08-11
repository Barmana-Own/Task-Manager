import { Router } from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { MANAGER_REVIEW_CRITERIA, REVIEW_CRITERIA } from '../utils/reviewScores.js';

const router = Router();
router.use(authenticate);

router.get('/assignable', (req, res, next) => {
  if (!['admin', 'project_manager'].includes(req.user.role) && !req.user.task_assignment_access) {
    return res.status(403).json({ message: 'دسترسی مشاهده برنامه‌نویس‌های قابل تخصیص را ندارید.' });
  }
  next();
}, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, full_name, username, email, role, is_active, manager_access, task_assignment_access
     FROM users
     WHERE is_active = 1
       AND (role IN ('developer', 'project_manager') OR manager_access = 1)
     ORDER BY FIELD(role, 'project_manager', 'developer'), full_name`,
  );
  res.json({ users: rows });
}));

router.get('/', authorize('admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.email, u.role, u.is_active, u.last_login_at, u.created_at,
      (u.manager_access = 1 OR u.role = 'project_manager') AS manager_access,
      (u.admin_access = 1 OR u.role = 'admin') AS admin_access,
      (u.task_assignment_access = 1 OR u.role IN ('admin', 'project_manager')) AS task_assignment_access,
      CASE
        WHEN u.role = 'developer' THEN (SELECT ROUND(AVG(tr.average_score), 2) FROM task_reviews tr WHERE tr.developer_id = u.id)
        WHEN u.role = 'project_manager' THEN (SELECT ROUND(AVG(mr.average_score), 2) FROM manager_reviews mr WHERE mr.manager_id = u.id)
        ELSE NULL
      END AS performance_score,
      CASE
        WHEN u.role = 'developer' THEN (SELECT COUNT(*) FROM task_reviews tr WHERE tr.developer_id = u.id)
        WHEN u.role = 'project_manager' THEN (SELECT COUNT(*) FROM manager_reviews mr WHERE mr.manager_id = u.id)
        ELSE 0
      END AS reviews_count
     FROM users u
     ORDER BY u.created_at DESC`,
  );
  res.json({ users: rows });
}));

router.get('/:id/performance', authorize('admin'), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  const [users] = await pool.execute('SELECT id, full_name, username, role FROM users WHERE id = ? LIMIT 1', [userId]);
  const target = users[0];
  if (!target) return res.status(404).json({ message: 'کاربر پیدا نشد.' });

  if (!['developer', 'project_manager'].includes(target.role)) {
    return res.json({ user: target, reviewType: null, summary: { totalReviews: 0, averageScore: null, criteria: [] }, recent: [] });
  }

  const isDeveloper = target.role === 'developer';
  const criteria = isDeveloper ? REVIEW_CRITERIA : MANAGER_REVIEW_CRITERIA;
  const table = isDeveloper ? 'task_reviews' : 'manager_reviews';
  const targetColumn = isDeveloper ? 'developer_id' : 'manager_id';
  const criteriaSql = criteria.map((item) => `ROUND(AVG(r.${item.key}), 2) AS ${item.key}`).join(', ');

  const [summaryRows] = await pool.execute(
    `SELECT COUNT(r.id) AS total_reviews, ROUND(AVG(r.average_score), 2) AS average_score, ${criteriaSql}
     FROM ${table} r WHERE r.${targetColumn} = ?`,
    [userId],
  );

  const [recentRows] = isDeveloper
    ? await pool.execute(
      `SELECT tr.task_id, tr.project_id, tr.average_score, tr.summary_note, tr.created_at,
        tr.on_time, tr.responsibility, tr.speed, tr.accuracy, tr.quality, tr.communication, tr.problem_solving, tr.documentation,
        t.title AS task_title, p.name AS project_name, reviewer.full_name AS reviewer_name, reviewer.role AS reviewer_role
       FROM task_reviews tr
       JOIN tasks t ON t.id = tr.task_id
       JOIN projects p ON p.id = tr.project_id
       JOIN users reviewer ON reviewer.id = tr.reviewer_id
       WHERE tr.developer_id = ?
       ORDER BY tr.created_at DESC LIMIT 50`,
      [userId],
    )
    : await pool.execute(
      `SELECT mr.task_id, mr.project_id, mr.average_score, mr.summary_note, mr.created_at,
        mr.clarity, mr.planning, mr.communication, mr.support, mr.availability, mr.fairness, mr.feedback_quality, mr.decision_making,
        t.title AS task_title, p.name AS project_name, reviewer.full_name AS reviewer_name, reviewer.role AS reviewer_role
       FROM manager_reviews mr
       JOIN tasks t ON t.id = mr.task_id
       JOIN projects p ON p.id = mr.project_id
       JOIN users reviewer ON reviewer.id = mr.reviewer_id
       WHERE mr.manager_id = ?
       ORDER BY mr.created_at DESC LIMIT 50`,
      [userId],
    );

  const summary = summaryRows[0] || { total_reviews: 0, average_score: null };
  const mappedCriteria = criteria.map((item) => ({
    key: item.key,
    label: item.label,
    average: summary[item.key] === null || summary[item.key] === undefined ? null : Number(summary[item.key]),
  }));
  const recent = recentRows.map((row) => ({
    ...row,
    criteria: criteria.map((item) => ({ key: item.key, label: item.label, score: Number(row[item.key]) })),
  }));

  res.json({
    user: target,
    reviewType: isDeveloper ? 'manager_to_developer' : 'developer_to_manager',
    summary: {
      totalReviews: Number(summary.total_reviews || 0),
      averageScore: summary.average_score === null || summary.average_score === undefined ? null : Number(summary.average_score),
      criteria: mappedCriteria,
    },
    recent,
  });
}));

router.post(
  '/',
  authorize('admin'),
  [
    body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('نام کامل معتبر نیست.'),
    body('username').trim().isLength({ min: 3, max: 60 }).matches(/^[\p{L}\p{N}_.-]+$/u).withMessage('نام کاربری معتبر نیست.'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('ایمیل معتبر نیست.'),
    body('password').matches(/^\d{8,20}$/).withMessage('رمز عبور باید فقط عدد و بین ۸ تا ۲۰ رقم باشد.'),
    body('role').isIn(['admin', 'project_manager', 'developer']).withMessage('نقش معتبر نیست.'),
    body('managerAccess').optional().isBoolean().withMessage('دسترسی مدیر پروژه معتبر نیست.'),
    body('adminAccess').optional().isBoolean().withMessage('دسترسی پنل ادمین معتبر نیست.'),
    body('taskAssignmentAccess').optional().isBoolean().withMessage('دسترسی تخصیص تسک معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { fullName, username, email, password, role, managerAccess = false, adminAccess = false, taskAssignmentAccess = false } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const effectiveManagerAccess = role === 'project_manager' ? true : Boolean(managerAccess);
    const effectiveAdminAccess = role === 'admin' ? true : Boolean(adminAccess);
    const effectiveTaskAssignmentAccess = ['admin', 'project_manager'].includes(role) ? true : Boolean(taskAssignmentAccess);
    const [result] = await pool.execute(
      `INSERT INTO users (full_name, username, email, password_hash, role, manager_access, admin_access, task_assignment_access)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fullName, username, email || null, passwordHash, role, effectiveManagerAccess ? 1 : 0, effectiveAdminAccess ? 1 : 0, effectiveTaskAssignmentAccess ? 1 : 0],
    );
    await audit({
      userId: req.user.id,
      entityType: 'user',
      entityId: result.insertId,
      action: 'create',
      metadata: { role, managerAccess: effectiveManagerAccess, adminAccess: effectiveAdminAccess, taskAssignmentAccess: effectiveTaskAssignmentAccess },
    });
    res.status(201).json({ message: 'کاربر ایجاد شد.', id: result.insertId });
  }),
);

router.patch(
  '/:id',
  authorize('admin'),
  [
    body('fullName').optional().trim().isLength({ min: 2, max: 120 }).withMessage('نام کامل معتبر نیست.'),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('ایمیل معتبر نیست.'),
    body('role').optional().isIn(['admin', 'project_manager', 'developer']).withMessage('نقش معتبر نیست.'),
    body('isActive').optional().isBoolean().withMessage('وضعیت حساب معتبر نیست.'),
    body('managerAccess').optional().isBoolean().withMessage('دسترسی مدیر پروژه معتبر نیست.'),
    body('adminAccess').optional().isBoolean().withMessage('دسترسی پنل ادمین معتبر نیست.'),
    body('taskAssignmentAccess').optional().isBoolean().withMessage('دسترسی تخصیص تسک معتبر نیست.'),
    body('password').optional({ checkFalsy: true }).matches(/^\d{8,20}$/).withMessage('رمز عبور باید فقط عدد و بین ۸ تا ۲۰ رقم باشد.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const [rows] = await pool.execute('SELECT id, role, secondary_role, manager_access, admin_access, task_assignment_access, is_active FROM users WHERE id = ? LIMIT 1', [userId]);
    const target = rows[0];
    if (!target) return res.status(404).json({ message: 'کاربر پیدا نشد.' });

    if (userId === Number(req.user.id) && req.body.isActive === false) {
      return res.status(400).json({ message: 'نمی‌توانید حساب خودتان را غیرفعال کنید.' });
    }
    if (userId === Number(req.user.id) && req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'نمی‌توانید نقش ادمین حساب خودتان را حذف کنید.' });
    }

    const willDeactivate = req.body.isActive === false && Boolean(target.is_active);
    const willChangeRole = req.body.role && req.body.role !== target.role;

    if (willDeactivate) {
      const [activeTimers] = await pool.execute('SELECT id FROM timer_sessions WHERE user_id = ? AND ended_at IS NULL LIMIT 1', [userId]);
      if (activeTimers[0]) return res.status(409).json({ message: 'ابتدا تایمر فعال این کاربر را متوقف کنید.' });
    }

    if (target.role === 'project_manager' && (willDeactivate || willChangeRole)) {
      const [managed] = await pool.execute('SELECT id FROM projects WHERE manager_id = ? AND status <> \'archived\' LIMIT 1', [userId]);
      if (managed[0]) return res.status(409).json({ message: 'ابتدا مدیریت پروژه‌های فعال این کاربر را به مدیر دیگری منتقل کنید.' });
    }

    if (target.role === 'developer' && (willDeactivate || willChangeRole)) {
      const [[openTask], [membership]] = await Promise.all([
        pool.execute("SELECT id FROM tasks WHERE assignee_id = ? AND status <> 'done' LIMIT 1", [userId]),
        pool.execute('SELECT project_id FROM project_members WHERE user_id = ? LIMIT 1', [userId]),
      ]);
      if (openTask[0]) {
        return res.status(409).json({ message: 'ابتدا تسک‌های باز این کاربر را به فرد دیگری منتقل کنید.' });
      }
      if (willChangeRole && membership[0]) {
        return res.status(409).json({ message: 'ابتدا کاربر را از پروژه‌ها حذف کنید، سپس نقش او را تغییر دهید.' });
      }
    }

    if (target.role === 'admin' && (willDeactivate || (willChangeRole && req.body.role !== 'admin'))) {
      const [[count]] = await pool.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [userId]);
      if (!Number(count.total)) return res.status(409).json({ message: 'سامانه باید حداقل یک ادمین فعال داشته باشد.' });
    }

    const fields = [];
    const values = [];
    const nextRole = req.body.role || target.role;

    if (Object.prototype.hasOwnProperty.call(req.body, 'managerAccess') || Object.prototype.hasOwnProperty.call(req.body, 'role')) {
      const managerAccess = nextRole === 'project_manager' ? true : Boolean(
        Object.prototype.hasOwnProperty.call(req.body, 'managerAccess') ? req.body.managerAccess : target.manager_access,
      );
      fields.push('manager_access = ?');
      values.push(managerAccess ? 1 : 0);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'adminAccess') || Object.prototype.hasOwnProperty.call(req.body, 'role')) {
      const adminAccess = nextRole === 'admin' ? true : Boolean(
        Object.prototype.hasOwnProperty.call(req.body, 'adminAccess') ? req.body.adminAccess : target.admin_access,
      );
      fields.push('admin_access = ?');
      values.push(adminAccess ? 1 : 0);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'taskAssignmentAccess') || Object.prototype.hasOwnProperty.call(req.body, 'role')) {
      const taskAssignmentAccess = ['admin', 'project_manager'].includes(nextRole) ? true : Boolean(
        Object.prototype.hasOwnProperty.call(req.body, 'taskAssignmentAccess') ? req.body.taskAssignmentAccess : target.task_assignment_access,
      );
      fields.push('task_assignment_access = ?');
      values.push(taskAssignmentAccess ? 1 : 0);
    }

    const mapping = { fullName: 'full_name', email: 'email', role: 'role', isActive: 'is_active' };
    for (const [key, column] of Object.entries(mapping)) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        fields.push(`${column} = ?`);
        values.push(req.body[key] === '' ? null : req.body[key]);
      }
    }
    if (req.body.password) {
      fields.push('password_hash = ?');
      values.push(await bcrypt.hash(req.body.password, 12));
    }
    if (!fields.length) return res.status(400).json({ message: 'تغییری ارسال نشده است.' });

    values.push(userId);
    await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    const { password: _password, ...safeMetadata } = req.body;
    await audit({ userId: req.user.id, entityType: 'user', entityId: userId, action: 'update', metadata: safeMetadata });
    res.json({ message: 'اطلاعات کاربر به‌روزرسانی شد.' });
  }),
);


router.delete('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(422).json({ message: 'شناسه کاربر معتبر نیست.' });
  }
  if (userId === Number(req.user.id)) {
    return res.status(400).json({ message: 'نمی‌توانید حساب کاربری خودتان را حذف کنید.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, full_name, username, role, is_active FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId],
    );
    const target = rows[0];
    if (!target) {
      await connection.rollback();
      return res.status(404).json({ message: 'کاربر پیدا نشد.' });
    }

    if (target.role === 'admin' && Boolean(target.is_active)) {
      const [[remaining]] = await connection.execute(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
        [userId],
      );
      if (!Number(remaining.total)) {
        await connection.rollback();
        return res.status(409).json({ message: 'سامانه باید حداقل یک ادمین فعال داشته باشد.' });
      }
    }

    const [assignmentResult, membershipResult, managedResult] = await Promise.all([
      connection.execute(
        'SELECT COUNT(*) AS total FROM tasks WHERE assignee_id = ?',
        [userId],
      ),
      connection.execute(
        'SELECT COUNT(*) AS total FROM project_members WHERE user_id = ?',
        [userId],
      ),
      connection.execute(
        'SELECT COUNT(*) AS total FROM projects WHERE manager_id = ?',
        [userId],
      ),
    ]);
    const assignmentStats = assignmentResult[0][0] || { total: 0 };
    const membershipStats = membershipResult[0][0] || { total: 0 };
    const managedStats = managedResult[0][0] || { total: 0 };

    // Preserve projects and tasks: ownership is transferred to the deleting admin,
    // while active assignments and project memberships are removed.
    await connection.execute('UPDATE projects SET manager_id = ? WHERE manager_id = ?', [req.user.id, userId]);
    await connection.execute('UPDATE tasks SET created_by = ? WHERE created_by = ?', [req.user.id, userId]);
    await connection.execute('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', [userId]);
    await connection.execute('DELETE FROM project_members WHERE user_id = ?', [userId]);
    await connection.execute('DELETE FROM users WHERE id = ?', [userId]);

    await audit({
      userId: req.user.id,
      entityType: 'user',
      entityId: userId,
      action: 'delete',
      metadata: {
        deletedUsername: target.username,
        deletedRole: target.role,
        unassignedTasks: Number(assignmentStats.total || 0),
        removedMemberships: Number(membershipStats.total || 0),
        transferredProjects: Number(managedStats.total || 0),
      },
      connection,
    });

    await connection.commit();
    res.json({
      message: `کاربر «${target.full_name}» حذف شد؛ عضویت‌های پروژه حذف و تسک‌های او بدون مسئول شدند.`,
      cleanup: {
        unassignedTasks: Number(assignmentStats.total || 0),
        removedMemberships: Number(membershipStats.total || 0),
        transferredProjects: Number(managedStats.total || 0),
      },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

export default router;
