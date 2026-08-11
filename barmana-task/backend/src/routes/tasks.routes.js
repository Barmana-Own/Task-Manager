import { Router } from 'express';
import { body, query } from 'express-validator';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { canAccessTask, getTaskContext } from '../utils/access.js';
import { notify, notifyMany } from '../utils/notify.js';
import { getAverageScore, getManagerAverageScore, validateManagerRatings, validateRatings } from '../utils/reviewScores.js';

const router = Router();
router.use(authenticate);

const taskStatuses = ['todo', 'in_progress', 'review', 'changes_requested', 'done'];
const priorities = ['low', 'medium', 'high', 'urgent'];


function hasTaskManagementAccess(user) {
  return ['admin', 'project_manager'].includes(user.role) || Boolean(user.task_assignment_access);
}

const authorizeTaskManager = (req, res, next) => {
  if (!hasTaskManagementAccess(req.user)) {
    return res.status(403).json({ message: 'دسترسی مدیریت و تخصیص تسک برای حساب شما فعال نیست.' });
  }
  next();
};

async function canManageProjectTasks(user, projectId, connection = pool) {
  if (user.role === 'admin') return true;
  if (user.role === 'project_manager') {
    const [rows] = await connection.execute('SELECT id FROM projects WHERE id = ? AND manager_id = ? LIMIT 1', [projectId, user.id]);
    return Boolean(rows[0]);
  }
  if (user.role === 'developer' && user.task_assignment_access) {
    const [rows] = await connection.execute(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
      [projectId, user.id],
    );
    return Boolean(rows[0]);
  }
  return false;
}

async function validateAssigneeForSection(connection, { projectId, sectionId, assigneeId, managerId }) {
  if (!assigneeId) return { valid: true };
  if (Number(assigneeId) === Number(managerId)) return { valid: true };
  const [userRows] = await connection.execute(
    `SELECT id FROM users WHERE id = ? AND role = 'developer' AND is_active = 1 LIMIT 1`,
    [assigneeId],
  );
  if (!userRows[0]) return { valid: false, message: 'مسئول انتخاب‌شده برنامه‌نویس فعال نیست.' };
  if (sectionId) {
    const [[countRow]] = await connection.execute('SELECT COUNT(*) AS total FROM project_section_members WHERE section_id = ?', [sectionId]);
    if (Number(countRow.total || 0) > 0) {
      const [memberRows] = await connection.execute('SELECT 1 FROM project_section_members WHERE section_id = ? AND user_id = ? LIMIT 1', [sectionId, assigneeId]);
      if (!memberRows[0]) return { valid: false, message: 'این برنامه‌نویس عضو تیم بخش انتخاب‌شده نیست.' };
      return { valid: true };
    }
  }
  const [projectRows] = await connection.execute('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, assigneeId]);
  return projectRows[0] ? { valid: true } : { valid: false, message: 'این برنامه‌نویس هنوز عضو پروژه یا تیم این بخش نیست.' };
}


function normalizeChecklistItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return { id: null, title: item.trim(), description: null };
      return {
        id: item?.id ? Number(item.id) : null,
        title: String(item?.title || '').trim(),
        description: String(item?.description || '').trim() || null,
      };
    })
    .filter((item) => item.title)
    .slice(0, 500);
}

async function syncChecklistItems({ connection, taskId, items, userId }) {
  const normalized = normalizeChecklistItems(items);
  const [existingRows] = await connection.execute(
    'SELECT id FROM task_checklist_items WHERE task_id = ? FOR UPDATE',
    [taskId],
  );
  const existingIds = new Set(existingRows.map((row) => Number(row.id)));
  const retainedIds = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const item = normalized[index];
    if (item.id && existingIds.has(item.id)) {
      await connection.execute(
        'UPDATE task_checklist_items SET title = ?, description = ?, sort_order = ? WHERE id = ? AND task_id = ?',
        [item.title, item.description, index + 1, item.id, taskId],
      );
      retainedIds.push(item.id);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO task_checklist_items (task_id, title, description, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [taskId, item.title, item.description, index + 1, userId],
      );
      retainedIds.push(Number(result.insertId));
    }
  }

  if (existingIds.size) {
    if (retainedIds.length) {
      const placeholders = retainedIds.map(() => '?').join(', ');
      await connection.execute(
        `DELETE FROM task_checklist_items WHERE task_id = ? AND id NOT IN (${placeholders})`,
        [taskId, ...retainedIds],
      );
    } else {
      await connection.execute('DELETE FROM task_checklist_items WHERE task_id = ?', [taskId]);
    }
  }

  return normalized.length;
}

function taskAccessClause(user, alias = 't') {
  if (user.role === 'project_manager') return { sql: '(p.manager_id = ? OR EXISTS (SELECT 1 FROM project_members pm_view WHERE pm_view.project_id = p.id AND pm_view.user_id = ?))', params: [user.id, user.id] };
  if (user.role === 'developer' && user.task_assignment_access) {
    return { sql: 'EXISTS (SELECT 1 FROM project_members pm_manage WHERE pm_manage.project_id = p.id AND pm_manage.user_id = ?)', params: [user.id] };
  }
  if (user.role === 'developer') return { sql: `${alias}.assignee_id = ?`, params: [user.id] };
  return { sql: '1 = 1', params: [] };
}

async function requireTaskAccess(req, res, connection = pool) {
  const task = await getTaskContext(Number(req.params.id), connection);
  if (!task) {
    res.status(404).json({ message: 'تسک پیدا نشد.' });
    return null;
  }
  let allowed = canAccessTask(req.user, task);
  if (!allowed && req.user.role === 'project_manager') {
    const [membership] = await connection.execute(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
      [task.project_id, req.user.id],
    );
    allowed = Boolean(membership[0]);
  }
  if (!allowed && req.user.role === 'developer' && req.user.task_assignment_access) {
    allowed = await canManageProjectTasks(req.user, task.project_id, connection);
  }
  if (!allowed) {
    res.status(403).json({ message: 'به این تسک دسترسی ندارید.' });
    return null;
  }
  return task;
}

router.get(
  '/',
  [
    query('projectId').optional().isInt({ min: 1 }).withMessage('پروژه معتبر نیست.'),
    query('assigneeId').optional().isInt({ min: 1 }).withMessage('مسئول معتبر نیست.'),
    query('sectionId').optional().isInt({ min: 1 }).withMessage('بخش پروژه معتبر نیست.'),
    query('status').optional().isIn(taskStatuses).withMessage('وضعیت معتبر نیست.'),
    query('priority').optional().isIn(priorities).withMessage('اولویت معتبر نیست.'),
    query('due').optional().isIn(['overdue', 'today', 'week']).withMessage('فیلتر مهلت معتبر نیست.'),
    query('q').optional().trim().isLength({ max: 100 }).withMessage('عبارت جست‌وجو طولانی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const access = taskAccessClause(req.user);
    const conditions = [access.sql];
    const params = [...access.params];

    if (req.query.projectId) {
      conditions.push('t.project_id = ?');
      params.push(Number(req.query.projectId));
    }
    if (req.query.assigneeId && req.user.role !== 'developer') {
      conditions.push('t.assignee_id = ?');
      params.push(Number(req.query.assigneeId));
    }
    if (req.query.sectionId) {
      conditions.push('t.section_id = ?');
      params.push(Number(req.query.sectionId));
    }
    if (req.query.status) {
      conditions.push('t.status = ?');
      params.push(req.query.status);
    }
    if (req.query.priority) {
      conditions.push('t.priority = ?');
      params.push(req.query.priority);
    }
    if (req.query.q) {
      conditions.push('(t.title LIKE ? OR t.description LIKE ? OR p.name LIKE ? OR p.code LIKE ? OR sec.title LIKE ?)');
      const search = `%${req.query.q}%`;
      params.push(search, search, search, search, search);
    }
    if (req.query.due === 'overdue') conditions.push("t.due_date < CURDATE() AND t.status <> 'done'");
    if (req.query.due === 'today') conditions.push('t.due_date = CURDATE()');
    if (req.query.due === 'week') conditions.push('t.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)');

    const [rows] = await pool.execute(
      `SELECT t.*, p.name AS project_name, p.code AS project_code, p.manager_id,
        sec.title AS section_title, sec.description AS section_description, sec.sort_order AS section_sort_order,
        a.full_name AS assignee_name, c.full_name AS creator_name, m.full_name AS manager_name,
        COALESCE(tt.tracked_seconds, 0) AS tracked_seconds,
        COALESCE(tc.comments_count, 0) AS comments_count,
        COALESCE(cl.checklist_total, 0) AS checklist_total,
        COALESCE(cl.checklist_completed, 0) AS checklist_completed,
        EXISTS(SELECT 1 FROM manager_reviews mr WHERE mr.task_id = t.id AND mr.reviewer_id = ${Number(req.user.id)}) AS has_manager_review,
        EXISTS(SELECT 1 FROM timer_sessions live WHERE live.task_id = t.id AND live.ended_at IS NULL) AS has_active_timer
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN project_sections sec ON sec.id = t.section_id
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN users c ON c.id = t.created_by
       LEFT JOIN users m ON m.id = p.manager_id
       LEFT JOIN (
         SELECT task_id, SUM(duration_seconds) AS tracked_seconds
         FROM timer_sessions GROUP BY task_id
       ) tt ON tt.task_id = t.id
       LEFT JOIN (
         SELECT task_id, COUNT(*) AS comments_count
         FROM task_comments GROUP BY task_id
       ) tc ON tc.task_id = t.id
       LEFT JOIN (
         SELECT task_id, COUNT(*) AS checklist_total, SUM(is_completed = 1) AS checklist_completed
         FROM task_checklist_items GROUP BY task_id
       ) cl ON cl.task_id = t.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(sec.sort_order, 999999), FIELD(t.priority, 'urgent', 'high', 'medium', 'low'),
         FIELD(t.status, 'review', 'changes_requested', 'in_progress', 'todo', 'done'),
         t.due_date IS NULL, t.due_date, t.sequence_no, t.updated_at DESC`,
      params,
    );
    const safeRows = rows.map((row) => ({ ...row, review_note: row.status === 'done' ? null : row.review_note }));
    res.json({ tasks: safeRows });
  }),
);

router.get('/:id', asyncHandler(async (req, res) => {
  const task = await requireTaskAccess(req, res);
  if (!task) return;

  const [[comments], [timeLogs], [managerReviewRows], [checklist], [dailyReports]] = await Promise.all([
    pool.execute(
      `SELECT tc.id, tc.body, tc.created_at, tc.updated_at,
        u.id AS user_id, u.full_name AS user_name, u.role AS user_role
       FROM task_comments tc JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id = ? ORDER BY tc.created_at ASC`,
      [task.id],
    ),
    pool.execute(
      `SELECT ts.id, ts.user_id, ts.started_at, ts.ended_at, ts.duration_seconds, ts.note,
        u.full_name AS user_name,
        CASE WHEN ts.ended_at IS NULL THEN TIMESTAMPDIFF(SECOND, ts.started_at, NOW()) ELSE ts.duration_seconds END AS effective_seconds
       FROM timer_sessions ts JOIN users u ON u.id = ts.user_id
       WHERE ts.task_id = ? ORDER BY ts.started_at DESC`,
      [task.id],
    ),
    req.user.role === 'developer'
      ? pool.execute('SELECT id FROM manager_reviews WHERE task_id = ? AND reviewer_id = ? LIMIT 1', [task.id, req.user.id])
      : Promise.resolve([[]]),
    pool.execute(
      `SELECT ci.id, ci.title, ci.description, ci.sort_order, ci.is_completed, ci.completed_by, ci.completed_at,
        completed.full_name AS completed_by_name
       FROM task_checklist_items ci
       LEFT JOIN users completed ON completed.id = ci.completed_by
       WHERE ci.task_id = ? ORDER BY ci.sort_order, ci.id`,
      [task.id],
    ),
    pool.execute(
      `SELECT dr.id, dr.report_date, dr.body, dr.created_at, dr.updated_at,
        (dr.report_date = CURDATE()) AS is_today,
        u.id AS user_id, u.full_name AS user_name, u.role AS user_role
       FROM task_daily_reports dr
       JOIN users u ON u.id = dr.user_id
       WHERE dr.task_id = ?
       ORDER BY dr.report_date DESC, dr.updated_at DESC`,
      [task.id],
    ),
  ]);

  const trackedSeconds = timeLogs.reduce((sum, row) => sum + Number(row.effective_seconds || 0), 0);
  const checklistCompleted = checklist.filter((item) => Boolean(item.is_completed)).length;
  res.json({
    task: {
      ...task,
      review_note: task.status === 'done' ? null : task.review_note,
      tracked_seconds: trackedSeconds,
      has_manager_review: Boolean(managerReviewRows[0]),
      checklist_total: checklist.length,
      checklist_completed: checklistCompleted,
    },
    comments,
    timeLogs,
    checklist,
    dailyReports,
  });
}));

router.post(
  '/',
  authorizeTaskManager,
  [
    body('projectId').isInt({ min: 1 }).withMessage('پروژه الزامی است.'),
    body('sectionId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('بخش پروژه معتبر نیست.'),
    body('title').trim().isLength({ min: 2, max: 220 }).withMessage('عنوان تسک معتبر نیست.'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('شرح تسک طولانی است.'),
    body('assigneeId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('مسئول معتبر نیست.'),
    body('priority').optional().isIn(priorities).withMessage('اولویت معتبر نیست.'),
    body('dueDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('تاریخ مهلت معتبر نیست.'),
    body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 1, max: 100000 }).withMessage('زمان تخمینی معتبر نیست.'),
    body('checklistItems').optional().isArray({ max: 500 }).withMessage('فهرست مراحل تسک معتبر نیست.'),
    body('checklistItems.*').optional().custom((item) => {
      const title = typeof item === 'string' ? item : item?.title;
      if (!String(title || '').trim() || String(title).trim().length > 500) {
        throw new Error('متن هر مرحله باید بین ۱ تا ۵۰۰ کاراکتر باشد.');
      }
      const description = typeof item === 'object' ? String(item?.description || '').trim() : '';
      if (description.length > 5000) {
        throw new Error('توضیحات هر مرحله نباید بیشتر از ۵۰۰۰ کاراکتر باشد.');
      }
      return true;
    }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const {
      projectId, sectionId, title, description, assigneeId, priority = 'medium', dueDate, estimatedMinutes,
      checklistItems = [],
    } = req.body;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [projects] = await connection.execute(
        'SELECT id, manager_id, status, name FROM projects WHERE id = ? FOR UPDATE',
        [projectId],
      );
      const project = projects[0];
      if (!project) {
        await connection.rollback();
        return res.status(404).json({ message: 'پروژه پیدا نشد.' });
      }
      if (req.user.role === 'project_manager' && Number(project.manager_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط در پروژه‌های خودتان می‌توانید تسک بسازید.' });
      }
      if (req.user.role === 'developer' && !(await canManageProjectTasks(req.user, projectId, connection))) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط در پروژه‌هایی که عضو آن هستید می‌توانید برای تیم تسک تعریف کنید.' });
      }
      if (['completed', 'archived'].includes(project.status)) {
        await connection.rollback();
        return res.status(400).json({ message: 'در پروژه تکمیل‌شده یا آرشیوشده نمی‌توان تسک جدید ساخت.' });
      }
      const [[sectionCountRow]] = await connection.execute(
        'SELECT COUNT(*) AS total FROM project_sections WHERE project_id = ?',
        [projectId],
      );
      if (Number(sectionCountRow.total || 0) > 0 && !sectionId) {
        await connection.rollback();
        return res.status(422).json({ message: 'برای این پروژه ابتدا بخش مربوط به تسک را انتخاب کنید.' });
      }
      if (sectionId) {
        const [sectionRows] = await connection.execute('SELECT id FROM project_sections WHERE id = ? AND project_id = ? LIMIT 1', [sectionId, projectId]);
        if (!sectionRows[0]) {
          await connection.rollback();
          return res.status(400).json({ message: 'بخش انتخاب‌شده متعلق به این پروژه نیست.' });
        }
      }
      if (assigneeId) {
        const assigneeCheck = await validateAssigneeForSection(connection, { projectId, sectionId: sectionId || null, assigneeId, managerId: project.manager_id });
        if (!assigneeCheck.valid) {
          await connection.rollback();
          return res.status(400).json({ message: assigneeCheck.message });
        }
      }

      const [[sequenceRow]] = await connection.execute(
        'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM tasks WHERE project_id = ?',
        [projectId],
      );
      const sequenceNo = Number(sequenceRow.next_sequence || 1);
      const [result] = await connection.execute(
        `INSERT INTO tasks
          (project_id, sequence_no, section_id, title, description, assignee_id, created_by, priority, due_date, estimated_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, sequenceNo, sectionId || null, title, description || null, assigneeId || null, req.user.id, priority, dueDate || null, estimatedMinutes || null],
      );
      const checklistCount = await syncChecklistItems({
        connection,
        taskId: result.insertId,
        items: checklistItems,
        userId: req.user.id,
      });
      await audit({
        userId: req.user.id,
        entityType: 'task',
        entityId: result.insertId,
        action: 'create',
        metadata: { projectId, sectionId: sectionId || null, assigneeId: assigneeId || null, priority, sequenceNo, checklistCount },
        connection,
      });
      if (assigneeId) {
        await notify({
          userId: assigneeId,
          type: 'task_assigned',
          title: 'تسک جدید به شما تخصیص داده شد',
          message: `تسک شماره ${String(sequenceNo).padStart(2, '0')}؛ ${title} در پروژه ${project.name}`,
          entityType: 'task',
          entityId: result.insertId,
          connection,
        });
      }
      await connection.commit();
      res.status(201).json({ message: `تسک شماره ${String(sequenceNo).padStart(2, '0')} ایجاد شد.`, id: result.insertId, sequenceNo });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.patch(
  '/:id',
  authorizeTaskManager,
  [
    body('sectionId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('بخش پروژه معتبر نیست.'),
    body('title').optional().trim().isLength({ min: 2, max: 220 }).withMessage('عنوان تسک معتبر نیست.'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('شرح تسک طولانی است.'),
    body('assigneeId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('مسئول معتبر نیست.'),
    body('priority').optional().isIn(priorities).withMessage('اولویت معتبر نیست.'),
    body('status').optional().isIn(taskStatuses).withMessage('وضعیت معتبر نیست.'),
    body('dueDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('تاریخ معتبر نیست.'),
    body('estimatedMinutes').optional({ nullable: true }).isInt({ min: 1, max: 100000 }).withMessage('زمان تخمینی معتبر نیست.'),
    body('checklistItems').optional().isArray({ max: 500 }).withMessage('فهرست مراحل تسک معتبر نیست.'),
    body('checklistItems.*').optional().custom((item) => {
      const title = typeof item === 'string' ? item : item?.title;
      if (!String(title || '').trim() || String(title).trim().length > 500) {
        throw new Error('متن هر مرحله باید بین ۱ تا ۵۰۰ کاراکتر باشد.');
      }
      if (typeof item === 'object' && item?.id !== undefined && item?.id !== null && (!Number.isInteger(Number(item.id)) || Number(item.id) < 1)) {
        throw new Error('شناسه مرحله معتبر نیست.');
      }
      const description = typeof item === 'object' ? String(item?.description || '').trim() : '';
      if (description.length > 5000) {
        throw new Error('توضیحات هر مرحله نباید بیشتر از ۵۰۰۰ کاراکتر باشد.');
      }
      return true;
    }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (req.user.role === 'project_manager' && Number(task.manager_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط مدیر پروژه می‌تواند این تسک را ویرایش کند.' });
      }
      if (req.user.role === 'developer' && !(await canManageProjectTasks(req.user, task.project_id, connection))) {
        await connection.rollback();
        return res.status(403).json({ message: 'دسترسی مدیریت تسک‌های این پروژه را ندارید.' });
      }
      if (['completed', 'archived'].includes(task.project_status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'برای ویرایش تسک، ابتدا پروژه را از وضعیت تکمیل یا آرشیو خارج کنید.' });
      }
      if (req.user.role !== 'admin' && Object.prototype.hasOwnProperty.call(req.body, 'status')) {
        await connection.rollback();
        return res.status(403).json({ message: 'تغییر وضعیت تحویل باید از جریان بازبینی انجام شود.' });
      }
      if (['review', 'done'].includes(task.status) && req.user.role !== 'admin') {
        await connection.rollback();
        return res.status(400).json({ message: 'تسک در وضعیت بازبینی یا تکمیل‌شده قابل ویرایش نیست.' });
      }

      const hasAssignee = Object.prototype.hasOwnProperty.call(req.body, 'assigneeId');
      const nextAssigneeId = hasAssignee && req.body.assigneeId ? Number(req.body.assigneeId) : null;
      if (hasAssignee && Number(task.assignee_id || 0) !== Number(nextAssigneeId || 0)) {
        const [active] = await connection.execute(
          'SELECT id FROM timer_sessions WHERE task_id = ? AND ended_at IS NULL LIMIT 1',
          [taskId],
        );
        if (active[0]) {
          await connection.rollback();
          return res.status(409).json({ message: 'تا زمانی که تایمر این تسک فعال است، مسئول آن قابل تغییر نیست.' });
        }
        if (nextAssigneeId) {
          const effectiveSectionId = Object.prototype.hasOwnProperty.call(req.body, 'sectionId') ? (req.body.sectionId || null) : task.section_id;
          const assigneeCheck = await validateAssigneeForSection(connection, { projectId: task.project_id, sectionId: effectiveSectionId, assigneeId: nextAssigneeId, managerId: task.manager_id });
          if (!assigneeCheck.valid) {
            await connection.rollback();
            return res.status(400).json({ message: assigneeCheck.message });
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'sectionId') && req.body.sectionId) {
        const [sectionRows] = await connection.execute('SELECT id FROM project_sections WHERE id = ? AND project_id = ? LIMIT 1', [req.body.sectionId, task.project_id]);
        if (!sectionRows[0]) {
          await connection.rollback();
          return res.status(400).json({ message: 'بخش انتخاب‌شده متعلق به این پروژه نیست.' });
        }
      }

      const mapping = {
        sectionId: 'section_id',
        title: 'title',
        description: 'description',
        assigneeId: 'assignee_id',
        priority: 'priority',
        dueDate: 'due_date',
        estimatedMinutes: 'estimated_minutes',
        status: 'status',
      };
      const fields = [];
      const values = [];
      for (const [key, column] of Object.entries(mapping)) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          fields.push(`${column} = ?`);
          const value = req.body[key];
          values.push(value === '' || value === undefined ? null : value);
        }
      }
      const hasChecklist = Object.prototype.hasOwnProperty.call(req.body, 'checklistItems');
      if (!fields.length && !hasChecklist) {
        await connection.rollback();
        return res.status(400).json({ message: 'تغییری ارسال نشده است.' });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'status') && ['review', 'done'].includes(req.body.status)) {
        const [activeStatusTimer] = await connection.execute(
          'SELECT id FROM timer_sessions WHERE task_id = ? AND ended_at IS NULL LIMIT 1',
          [taskId],
        );
        if (activeStatusTimer[0]) {
          await connection.rollback();
          return res.status(409).json({ message: 'پیش از تغییر وضعیت، تایمر فعال این تسک را متوقف کنید.' });
        }
      }

      if (fields.length) {
        values.push(taskId);
        await connection.execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
        await connection.execute(
          req.body.status === 'done'
            ? 'UPDATE tasks SET completed_at = COALESCE(completed_at, NOW()) WHERE id = ?'
            : 'UPDATE tasks SET completed_at = NULL WHERE id = ?',
          [taskId],
        );
      }
      let checklistCount = null;
      if (hasChecklist) {
        checklistCount = await syncChecklistItems({
          connection,
          taskId,
          items: req.body.checklistItems,
          userId: req.user.id,
        });
      }
      await audit({
        userId: req.user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        metadata: { ...req.body, ...(checklistCount === null ? {} : { checklistCount }) },
        connection,
      });

      if (hasAssignee && nextAssigneeId && Number(task.assignee_id || 0) !== nextAssigneeId) {
        await notify({
          userId: nextAssigneeId,
          type: 'task_assigned',
          title: 'یک تسک به شما تخصیص داده شد',
          message: `${req.body.title || task.title} در پروژه ${task.project_name}`,
          entityType: 'task',
          entityId: taskId,
          connection,
        });
      }
      await connection.commit();
      res.json({ message: 'تسک و مراحل آن به‌روزرسانی شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.delete('/:id', authorizeTaskManager, asyncHandler(async (req, res) => {
  const taskId = Number(req.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const task = await getTaskContext(taskId, connection);
    if (!task) {
      await connection.rollback();
      return res.status(404).json({ message: 'تسک پیدا نشد.' });
    }
    if (req.user.role === 'project_manager' && Number(task.manager_id) !== Number(req.user.id)) {
      await connection.rollback();
      return res.status(403).json({ message: 'فقط مدیر همین پروژه می‌تواند تسک را حذف کند.' });
    }
    if (req.user.role === 'developer' && !(await canManageProjectTasks(req.user, task.project_id, connection))) {
      await connection.rollback();
      return res.status(403).json({ message: 'دسترسی حذف تسک‌های این پروژه را ندارید.' });
    }
    const [activeTimers] = await connection.execute(
      'SELECT id FROM timer_sessions WHERE task_id = ? AND ended_at IS NULL LIMIT 1 FOR UPDATE',
      [taskId],
    );
    if (activeTimers[0]) {
      await connection.rollback();
      return res.status(409).json({ message: 'برای حذف تسک ابتدا تایمر فعال آن را متوقف کنید.' });
    }
    await audit({
      userId: req.user.id,
      entityType: 'task',
      entityId: taskId,
      action: 'delete',
      metadata: { projectId: task.project_id, title: task.title, sequenceNo: task.sequence_no },
      connection,
    });
    await connection.execute('DELETE FROM tasks WHERE id = ?', [taskId]);
    await connection.commit();
    res.json({ message: `تسک شماره ${String(task.sequence_no).padStart(2, '0')} حذف شد.` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post(
  '/:id/complete-self',
  authorize('project_manager'),
  [body('completionNote').optional({ checkFalsy: true }).trim().isLength({ max: 10000 }).withMessage('توضیحات تکمیل طولانی است.')],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (Number(task.manager_id) !== Number(req.user.id) || Number(task.assignee_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط تسک شخصی خود مدیر پروژه از این مسیر قابل تکمیل است.' });
      }
      if (['completed', 'archived'].includes(task.project_status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'پروژه بسته است.' });
      }
      const [activeTimers] = await connection.execute('SELECT id FROM timer_sessions WHERE task_id = ? AND ended_at IS NULL LIMIT 1', [taskId]);
      if (activeTimers[0]) {
        await connection.rollback();
        return res.status(409).json({ message: 'پیش از تکمیل تسک، تایمر فعال را متوقف کنید.' });
      }
      const [[checklist]] = await connection.execute(
        'SELECT COUNT(*) AS total, SUM(is_completed = 1) AS completed FROM task_checklist_items WHERE task_id = ?',
        [taskId],
      );
      if (Number(checklist.total || 0) > Number(checklist.completed || 0)) {
        await connection.rollback();
        return res.status(409).json({ message: 'ابتدا تمام موارد چک‌لیست این تسک را تکمیل کنید.' });
      }
      await connection.execute(
        `UPDATE tasks SET status = 'done', completion_note = ?, submitted_at = COALESCE(submitted_at, NOW()), completed_at = NOW()
         WHERE id = ?`,
        [req.body.completionNote || 'تکمیل‌شده توسط مدیر پروژه برای تسک شخصی', taskId],
      );
      await audit({
        userId: req.user.id,
        entityType: 'task',
        entityId: taskId,
        action: 'complete_self',
        metadata: { projectId: task.project_id },
        connection,
      });
      await connection.commit();
      res.json({ message: 'تسک شخصی مدیر پروژه تکمیل شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.post(
  '/:id/submit',
  authorize('developer'),
  [
    body('completionNote').trim().isLength({ min: 5, max: 10000 }).withMessage('توضیحات پایان کار باید حداقل ۵ کاراکتر باشد.'),
    body('completionLink').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('لینک تحویل معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (Number(task.assignee_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'این تسک به شما اختصاص ندارد.' });
      }
      if (['completed', 'archived'].includes(task.project_status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'پروژه بسته است و تحویل جدید نمی‌پذیرد.' });
      }
      if (!['in_progress', 'changes_requested'].includes(task.status)) {
        await connection.rollback();
        return res.status(400).json({ message: 'تسک در وضعیت قابل ارسال نیست.' });
      }
      const [active] = await connection.execute(
        'SELECT id FROM timer_sessions WHERE task_id = ? AND user_id = ? AND ended_at IS NULL',
        [taskId, req.user.id],
      );
      if (active[0]) {
        await connection.rollback();
        return res.status(400).json({ message: 'ابتدا تایمر فعال این تسک را متوقف کنید.' });
      }
      const [[checklistStatus]] = await connection.execute(
        `SELECT COUNT(*) AS total, SUM(is_completed = 1) AS completed
         FROM task_checklist_items WHERE task_id = ?`,
        [taskId],
      );
      const checklistTotal = Number(checklistStatus.total || 0);
      const checklistCompleted = Number(checklistStatus.completed || 0);
      if (checklistTotal > checklistCompleted) {
        await connection.rollback();
        return res.status(409).json({ message: `ابتدا همه مراحل تسک را تکمیل کنید (${checklistCompleted} از ${checklistTotal}).` });
      }

      await connection.execute(
        `UPDATE tasks SET status = 'review', completion_note = ?, completion_link = ?,
          submitted_at = NOW(), review_note = NULL, completed_at = NULL
         WHERE id = ?`,
        [req.body.completionNote, req.body.completionLink || null, taskId],
      );
      await audit({ userId: req.user.id, entityType: 'task', entityId: taskId, action: 'submit_for_review', connection });
      await notify({
        userId: task.manager_id,
        type: 'task_review',
        title: 'تسک آماده بازبینی است',
        message: `${task.title} توسط ${req.user.full_name} ارسال شد.`,
        entityType: 'task',
        entityId: taskId,
        connection,
      });
      await connection.commit();
      res.json({ message: 'تسک برای بازبینی مدیر ارسال شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.post(
  '/:id/review',
  authorize('admin', 'project_manager'),
  [
    body('decision').isIn(['approve', 'request_changes']).withMessage('تصمیم معتبر نیست.'),
    body('note').optional({ checkFalsy: true }).trim().isLength({ min: 3, max: 5000 }).withMessage('یادداشت بازبینی معتبر نیست.'),
    body('ratings').optional().isObject().withMessage('ساختار امتیازدهی معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (req.user.role === 'project_manager' && Number(task.manager_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط مدیر پروژه می‌تواند این تسک را بازبینی کند.' });
      }
      if (task.status !== 'review') {
        await connection.rollback();
        return res.status(400).json({ message: 'تسک در صف بازبینی نیست.' });
      }
      if (req.body.decision === 'request_changes' && !req.body.note) {
        await connection.rollback();
        return res.status(422).json({ message: 'برای برگشت تسک، توضیح اصلاحات الزامی است.' });
      }

      const approved = req.body.decision === 'approve';
      let reviewAverage = null;
      let reviewRatings = null;
      if (approved) {
        if (!task.assignee_id) {
          await connection.rollback();
          return res.status(422).json({ message: 'برای تأیید نهایی باید برنامه‌نویس مشخص باشد.' });
        }
        const { valid, normalized } = validateRatings(req.body.ratings || {});
        if (!valid) {
          await connection.rollback();
          return res.status(422).json({ message: 'برای تأیید نهایی باید به همه معیارها از ۱ تا ۵ امتیاز بدهید.' });
        }
        reviewRatings = normalized;
        reviewAverage = getAverageScore(normalized);
      }

      await connection.execute(
        `UPDATE tasks SET status = ?, review_note = ?, completed_at = ${approved ? 'NOW()' : 'NULL'} WHERE id = ?`,
        [approved ? 'done' : 'changes_requested', approved ? null : (req.body.note || null), taskId],
      );

      if (approved && task.assignee_id) {
        await connection.execute(
          `INSERT INTO task_reviews
            (task_id, project_id, reviewer_id, developer_id, on_time, responsibility, speed, accuracy, quality, communication, problem_solving, documentation, average_score, summary_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             reviewer_id = VALUES(reviewer_id),
             on_time = VALUES(on_time),
             responsibility = VALUES(responsibility),
             speed = VALUES(speed),
             accuracy = VALUES(accuracy),
             quality = VALUES(quality),
             communication = VALUES(communication),
             problem_solving = VALUES(problem_solving),
             documentation = VALUES(documentation),
             average_score = VALUES(average_score),
             summary_note = VALUES(summary_note),
             updated_at = CURRENT_TIMESTAMP`,
          [
            taskId, task.project_id, req.user.id, task.assignee_id,
            reviewRatings.on_time, reviewRatings.responsibility, reviewRatings.speed, reviewRatings.accuracy,
            reviewRatings.quality, reviewRatings.communication, reviewRatings.problem_solving, reviewRatings.documentation,
            reviewAverage, req.body.note || null,
          ],
        );
      }

      await audit({
        userId: req.user.id,
        entityType: 'task',
        entityId: taskId,
        action: approved ? 'approve' : 'request_changes',
        metadata: approved ? { confidentialEvaluation: true } : { correctionNote: req.body.note || null },
        connection,
      });
      if (task.assignee_id) {
        await notify({
          userId: task.assignee_id,
          type: approved ? 'task_approved' : 'task_changes_requested',
          title: approved ? 'تسک شما تأیید شد' : 'تسک برای اصلاح برگشت خورد',
          message: approved ? `${task.title} با موفقیت تأیید شد.` : `${task.title}: ${req.body.note}`, 
          entityType: 'task',
          entityId: taskId,
          connection,
        });
      }
      await connection.commit();
      res.json({ message: approved ? 'تسک تأیید شد و ارزیابی محرمانه برای ادمین ثبت شد.' : 'تسک برای اصلاح برگشت داده شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.post(
  '/:id/manager-review',
  authorize('developer'),
  [
    body('ratings').isObject().withMessage('ساختار امتیازدهی معتبر نیست.'),
    body('note').trim().isLength({ min: 3, max: 5000 }).withMessage('ثبت نظر محرمانه الزامی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (Number(task.assignee_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط برنامه‌نویس مسئول این تسک می‌تواند مدیر پروژه را ارزیابی کند.' });
      }
      if (task.status !== 'done') {
        await connection.rollback();
        return res.status(409).json({ message: 'ارزیابی مدیر پروژه بعد از تأیید نهایی تسک قابل ثبت است.' });
      }
      const [existing] = await connection.execute(
        'SELECT id FROM manager_reviews WHERE task_id = ? AND reviewer_id = ? LIMIT 1 FOR UPDATE',
        [taskId, req.user.id],
      );
      if (existing[0]) {
        await connection.rollback();
        return res.status(409).json({ message: 'ارزیابی محرمانه این تسک قبلاً ثبت شده است.' });
      }

      const { valid, normalized } = validateManagerRatings(req.body.ratings || {});
      if (!valid) {
        await connection.rollback();
        return res.status(422).json({ message: 'برای همه معیارهای مدیر پروژه باید از ۱ تا ۵ امتیاز ثبت کنید.' });
      }
      const averageScore = getManagerAverageScore(normalized);
      await connection.execute(
        `INSERT INTO manager_reviews
          (task_id, project_id, reviewer_id, manager_id, clarity, planning, communication, support, availability, fairness, feedback_quality, decision_making, average_score, summary_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId, task.project_id, req.user.id, task.manager_id,
          normalized.clarity, normalized.planning, normalized.communication, normalized.support,
          normalized.availability, normalized.fairness, normalized.feedback_quality, normalized.decision_making,
          averageScore, req.body.note,
        ],
      );
      await audit({
        userId: req.user.id,
        entityType: 'manager_review',
        entityId: taskId,
        action: 'create_confidential',
        metadata: { confidential: true, targetUserId: task.manager_id },
        connection,
      });
      await connection.commit();
      res.status(201).json({ message: 'امتیاز و نظر محرمانه ثبت شد و فقط ادمین می‌تواند آن را مشاهده کند.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);


router.patch(
  '/:id/checklist/:itemId',
  [body('isCompleted').isBoolean().withMessage('وضعیت مرحله معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      const isAssignedWorker = ['developer', 'project_manager'].includes(req.user.role)
        && Number(task.assignee_id) === Number(req.user.id);
      if (!isAssignedWorker && req.user.role !== 'admin') {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط مسئول این تسک می‌تواند مراحل را تیک بزند.' });
      }
      if (['review', 'done'].includes(task.status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'در وضعیت بازبینی یا تکمیل‌شده امکان تغییر مراحل وجود ندارد.' });
      }
      const [items] = await connection.execute(
        'SELECT id, title FROM task_checklist_items WHERE id = ? AND task_id = ? LIMIT 1 FOR UPDATE',
        [itemId, taskId],
      );
      if (!items[0]) {
        await connection.rollback();
        return res.status(404).json({ message: 'مرحله تسک پیدا نشد.' });
      }
      const completed = Boolean(req.body.isCompleted);
      await connection.execute(
        `UPDATE task_checklist_items
         SET is_completed = ?, completed_by = ?, completed_at = ?
         WHERE id = ? AND task_id = ?`,
        [completed ? 1 : 0, completed ? req.user.id : null, completed ? new Date() : null, itemId, taskId],
      );
      if (completed && task.status === 'todo') {
        await connection.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", [taskId]);
      }
      await audit({
        userId: req.user.id,
        entityType: 'task_checklist_item',
        entityId: itemId,
        action: completed ? 'complete' : 'reopen',
        metadata: { taskId, title: items[0].title },
        connection,
      });
      const [[progress]] = await connection.execute(
        `SELECT COUNT(*) AS total, SUM(is_completed = 1) AS completed
         FROM task_checklist_items WHERE task_id = ?`,
        [taskId],
      );
      await connection.commit();
      res.json({
        message: completed ? 'مرحله انجام‌شده ثبت شد.' : 'مرحله دوباره باز شد.',
        progress: { total: Number(progress.total || 0), completed: Number(progress.completed || 0) },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.post(
  '/:id/daily-report',
  authorize('developer', 'project_manager'),
  [body('body').trim().isLength({ min: 3, max: 5000 }).withMessage('گزارش امروز باید بین ۳ تا ۵۰۰۰ کاراکتر باشد.')],
  validate,
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(taskId, connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (Number(task.assignee_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'فقط مسئول این تسک می‌تواند گزارش روزانه ثبت کند.' });
      }
      if (['completed', 'archived'].includes(task.project_status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'پروژه بسته است و گزارش جدید نمی‌پذیرد.' });
      }
      if (['review', 'done'].includes(task.status)) {
        await connection.rollback();
        return res.status(409).json({ message: 'تسک در وضعیت بازبینی یا تکمیل‌شده گزارش روزانه جدید نمی‌پذیرد.' });
      }
      await connection.execute(
        `INSERT INTO task_daily_reports (task_id, user_id, report_date, body)
         VALUES (?, ?, CURDATE(), ?)
         ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = CURRENT_TIMESTAMP`,
        [taskId, req.user.id, req.body.body],
      );
      if (task.status === 'todo') {
        await connection.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", [taskId]);
      }
      await audit({
        userId: req.user.id,
        entityType: 'task_daily_report',
        entityId: taskId,
        action: 'upsert_today',
        metadata: { taskId },
        connection,
      });
      await notify({
        userId: task.manager_id,
        type: 'task_daily_report',
        title: 'گزارش روزانه تسک ثبت شد',
        message: `${req.user.full_name} برای تسک «${task.title}» گزارش امروز را ثبت کرد.`,
        entityType: 'task',
        entityId: taskId,
        connection,
      });
      await connection.commit();
      res.json({ message: 'گزارش امروز روی تسک ذخیره شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.post(
  '/:id/comments',
  [body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('متن پیام معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const task = await getTaskContext(Number(req.params.id), connection);
      if (!task) {
        await connection.rollback();
        return res.status(404).json({ message: 'تسک پیدا نشد.' });
      }
      if (!canAccessTask(req.user, task)) {
        await connection.rollback();
        return res.status(403).json({ message: 'به این تسک دسترسی ندارید.' });
      }
      const [result] = await connection.execute(
        'INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)',
        [task.id, req.user.id, req.body.body],
      );
      await audit({ userId: req.user.id, entityType: 'task_comment', entityId: result.insertId, action: 'create', metadata: { taskId: task.id }, connection });
      const recipients = [task.manager_id, task.assignee_id].filter((id) => Number(id) !== Number(req.user.id));
      await notifyMany({
        userIds: recipients,
        type: 'task_comment',
        title: 'پیام جدید روی تسک',
        message: `${req.user.full_name}: ${req.body.body.slice(0, 180)}`,
        entityType: 'task',
        entityId: task.id,
        connection,
      });
      await connection.commit();
      res.status(201).json({ message: 'پیام ثبت شد.', id: result.insertId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.delete('/:taskId/comments/:commentId', asyncHandler(async (req, res) => {
  const task = await getTaskContext(Number(req.params.taskId));
  if (!task) return res.status(404).json({ message: 'تسک پیدا نشد.' });
  if (!canAccessTask(req.user, task)) return res.status(403).json({ message: 'به این تسک دسترسی ندارید.' });

  const [comments] = await pool.execute('SELECT user_id FROM task_comments WHERE id = ? AND task_id = ?', [Number(req.params.commentId), task.id]);
  if (!comments[0]) return res.status(404).json({ message: 'پیام پیدا نشد.' });
  if (req.user.role !== 'admin' && Number(comments[0].user_id) !== Number(req.user.id)) {
    return res.status(403).json({ message: 'فقط نویسنده یا ادمین می‌تواند این پیام را حذف کند.' });
  }
  await pool.execute('DELETE FROM task_comments WHERE id = ?', [Number(req.params.commentId)]);
  await audit({ userId: req.user.id, entityType: 'task_comment', entityId: Number(req.params.commentId), action: 'delete', metadata: { taskId: task.id } });
  res.json({ message: 'پیام حذف شد.' });
}));

export default router;
