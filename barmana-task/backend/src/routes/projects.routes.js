import { Router } from 'express';
import { body, query } from 'express-validator';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { notifyMany } from '../utils/notify.js';

const router = Router();
router.use(authenticate);
const statuses = ['planning', 'active', 'on_hold', 'completed', 'archived'];

function accessWhere(user) {
  if (user.role === 'project_manager') return { sql: '(p.manager_id = ? OR EXISTS (SELECT 1 FROM project_members pm_access WHERE pm_access.project_id = p.id AND pm_access.user_id = ?))', params: [user.id, user.id] };
  if (user.role === 'developer') {
    return { sql: 'EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?)', params: [user.id] };
  }
  return { sql: '1 = 1', params: [] };
}

router.get(
  '/',
  [
    query('status').optional().isIn(statuses).withMessage('وضعیت معتبر نیست.'),
    query('q').optional().trim().isLength({ max: 100 }).withMessage('عبارت جست‌وجو طولانی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const access = accessWhere(req.user);
    const conditions = [access.sql];
    const params = [...access.params];
    if (req.query.status) {
      conditions.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      conditions.push('(p.name LIKE ? OR p.code LIKE ? OR p.description LIKE ?)');
      const search = `%${req.query.q}%`;
      params.push(search, search, search);
    }

    const [rows] = await pool.execute(
      `SELECT p.*, u.full_name AS manager_name,
        ((SELECT COUNT(DISTINCT pm.user_id) FROM project_members pm WHERE pm.project_id = p.id) + CASE WHEN EXISTS (SELECT 1 FROM project_members pm_manager WHERE pm_manager.project_id = p.id AND pm_manager.user_id = p.manager_id) THEN 0 ELSE 1 END) AS members_count,
        (SELECT COUNT(*) FROM project_sections ps WHERE ps.project_id = p.id) AS sections_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS tasks_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_tasks_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'review') AS review_tasks_count,
        COALESCE((SELECT SUM(ts.duration_seconds) FROM timer_sessions ts JOIN tasks t ON t.id = ts.task_id WHERE t.project_id = p.id), 0) AS tracked_seconds
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY FIELD(p.status, 'active', 'planning', 'on_hold', 'completed', 'archived'), p.updated_at DESC`,
      params,
    );
    res.json({ projects: rows });
  }),
);

router.get('/:id', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);
  const [projects] = await pool.execute(
    `SELECT p.*, u.full_name AS manager_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS tasks_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_tasks_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'review') AS review_tasks_count,
      COALESCE((SELECT SUM(ts.duration_seconds) FROM timer_sessions ts JOIN tasks t ON t.id = ts.task_id WHERE t.project_id = p.id), 0) AS tracked_seconds
     FROM projects p LEFT JOIN users u ON u.id = p.manager_id WHERE p.id = ?`,
    [projectId],
  );
  const project = projects[0];
  if (!project) return res.status(404).json({ message: 'پروژه پیدا نشد.' });
  if (req.user.role === 'project_manager' && Number(project.manager_id) !== Number(req.user.id)) {
    const [membership] = await pool.execute('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, req.user.id]);
    if (!membership[0]) return res.status(403).json({ message: 'به این پروژه دسترسی ندارید.' });
  }
  if (req.user.role === 'developer') {
    const [membership] = await pool.execute('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, req.user.id]);
    if (!membership[0]) return res.status(403).json({ message: 'به این پروژه دسترسی ندارید.' });
  }

  const [[members], [statusCounts], [sections], [sectionMemberRows]] = await Promise.all([
    pool.execute(
      `SELECT u.id, u.full_name, u.username, u.email, u.role, u.is_active,
        u.manager_access, u.task_assignment_access, team.is_project_manager,
        COUNT(t.id) AS assigned_tasks,
        COALESCE(SUM(t.status = 'done'), 0) AS done_tasks
       FROM (
         SELECT p.manager_id AS user_id, 1 AS is_project_manager
         FROM projects p WHERE p.id = ?
         UNION ALL
         SELECT pm.user_id, 0 AS is_project_manager
         FROM project_members pm
         JOIN projects p2 ON p2.id = pm.project_id
         WHERE pm.project_id = ? AND pm.user_id <> p2.manager_id
       ) team
       JOIN users u ON u.id = team.user_id
       LEFT JOIN tasks t ON t.project_id = ? AND t.assignee_id = u.id
       WHERE u.is_active = 1
       GROUP BY u.id, team.is_project_manager
       ORDER BY team.is_project_manager DESC, FIELD(u.role, 'project_manager', 'developer', 'admin'), u.full_name`,
      [projectId, projectId, projectId],
    ),
    pool.execute(
      `SELECT status, COUNT(*) AS total FROM tasks WHERE project_id = ? GROUP BY status`,
      [projectId],
    ),
    pool.execute(
      `SELECT ps.id, ps.title, ps.description, ps.sort_order, ps.created_at, ps.updated_at,
        COUNT(t.id) AS tasks_count, SUM(t.status = 'done') AS done_tasks_count
       FROM project_sections ps
       LEFT JOIN tasks t ON t.section_id = ps.id
       WHERE ps.project_id = ?
       GROUP BY ps.id
       ORDER BY ps.sort_order, ps.id`,
      [projectId],
    ),
    pool.execute(
      `SELECT psm.section_id, u.id, u.full_name, u.username, u.email, u.role
       FROM project_section_members psm
       JOIN project_sections ps ON ps.id = psm.section_id
       JOIN users u ON u.id = psm.user_id
       WHERE ps.project_id = ? AND u.is_active = 1
       ORDER BY u.full_name`,
      [projectId],
    ),
  ]);
  const sectionMemberMap = new Map();
  for (const row of sectionMemberRows) {
    const key = Number(row.section_id);
    if (!sectionMemberMap.has(key)) sectionMemberMap.set(key, []);
    sectionMemberMap.get(key).push({ id: row.id, full_name: row.full_name, username: row.username, email: row.email, role: row.role });
  }
  const enrichedSections = sections.map((section) => ({ ...section, members: sectionMemberMap.get(Number(section.id)) || [] }));
  res.json({ project, members, statusCounts, sections: enrichedSections });
}));


async function requireProjectManagerAccess(req, res, projectId, connection = pool) {
  const [rows] = await connection.execute('SELECT id, manager_id, status FROM projects WHERE id = ? LIMIT 1', [projectId]);
  const project = rows[0];
  if (!project) {
    res.status(404).json({ message: 'پروژه پیدا نشد.' });
    return null;
  }
  if (req.user.role === 'project_manager' && Number(project.manager_id) !== Number(req.user.id)) {
    const [membership] = await connection.execute(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
      [projectId, req.user.id],
    );
    if (!membership[0]) {
      res.status(403).json({ message: 'فقط مدیران عضو همین پروژه می‌توانند ساختار و اعضای آن را مدیریت کنند.' });
      return null;
    }
  }
  if (req.user.role === 'developer') {
    if (!req.user.task_assignment_access) {
      res.status(403).json({ message: 'دسترسی مدیریت بخش‌های پروژه برای حساب شما فعال نیست.' });
      return null;
    }
    const [membership] = await connection.execute('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, req.user.id]);
    if (!membership[0]) {
      res.status(403).json({ message: 'فقط بخش‌های پروژه‌هایی که عضو آن هستید قابل مدیریت است.' });
      return null;
    }
  }
  return project;
}

router.post(
  '/:id/sections',
  [
    body('title').trim().isLength({ min: 2, max: 180 }).withMessage('عنوان بخش معتبر نیست.'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('توضیحات بخش طولانی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const project = await requireProjectManagerAccess(req, res, projectId);
    if (!project) return;
    if (['completed', 'archived'].includes(project.status)) return res.status(409).json({ message: 'پروژه بسته است و بخش جدید قابل ایجاد نیست.' });
    const [[nextRow]] = await pool.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM project_sections WHERE project_id = ?', [projectId]);
    const [result] = await pool.execute(
      'INSERT INTO project_sections (project_id, title, description, sort_order, created_by) VALUES (?, ?, ?, ?, ?)',
      [projectId, req.body.title, req.body.description || null, Number(nextRow.next_order || 1), req.user.id],
    );
    await audit({ userId: req.user.id, entityType: 'project_section', entityId: result.insertId, action: 'create', metadata: { projectId, title: req.body.title } });
    res.status(201).json({ message: 'بخش پروژه ایجاد شد.', id: result.insertId });
  }),
);

router.patch(
  '/:id/sections/:sectionId',
  [
    body('title').optional().trim().isLength({ min: 2, max: 180 }).withMessage('عنوان بخش معتبر نیست.'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('توضیحات بخش طولانی است.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const sectionId = Number(req.params.sectionId);
    const project = await requireProjectManagerAccess(req, res, projectId);
    if (!project) return;
    const fields = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(req.body, 'title')) { fields.push('title = ?'); values.push(req.body.title); }
    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) { fields.push('description = ?'); values.push(req.body.description || null); }
    if (!fields.length) return res.status(400).json({ message: 'تغییری ارسال نشده است.' });
    values.push(sectionId, projectId);
    const [result] = await pool.execute(`UPDATE project_sections SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`, values);
    if (!result.affectedRows) return res.status(404).json({ message: 'بخش پروژه پیدا نشد.' });
    await audit({ userId: req.user.id, entityType: 'project_section', entityId: sectionId, action: 'update', metadata: { projectId, ...req.body } });
    res.json({ message: 'بخش پروژه به‌روزرسانی شد.' });
  }),
);

router.put(
  '/:id/sections/:sectionId/members',
  [
    body('memberIds').isArray({ max: 500 }).withMessage('فهرست برنامه‌نویس‌های بخش معتبر نیست.'),
    body('memberIds.*').optional().isInt({ min: 1 }).withMessage('شناسه برنامه‌نویس معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const sectionId = Number(req.params.sectionId);
    const project = await requireProjectManagerAccess(req, res, projectId);
    if (!project) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [sectionRows] = await connection.execute('SELECT id FROM project_sections WHERE id = ? AND project_id = ? FOR UPDATE', [sectionId, projectId]);
      if (!sectionRows[0]) { await connection.rollback(); return res.status(404).json({ message: 'بخش پروژه پیدا نشد.' }); }
      const memberIds = [...new Set((req.body.memberIds || []).map(Number).filter(Boolean))];
      if (memberIds.length) {
        const placeholders = memberIds.map(() => '?').join(',');
        const [valid] = await connection.execute(`SELECT id FROM users WHERE id IN (${placeholders}) AND role = 'developer' AND is_active = 1`, memberIds);
        if (valid.length !== memberIds.length) { await connection.rollback(); return res.status(400).json({ message: 'همه اعضای بخش باید برنامه‌نویس فعال باشند.' }); }
      }
      await connection.execute('DELETE FROM project_section_members WHERE section_id = ?', [sectionId]);
      for (const userId of memberIds) {
        await connection.execute('INSERT IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', [projectId, userId]);
        await connection.execute('INSERT INTO project_section_members (section_id, user_id, assigned_by) VALUES (?, ?, ?)', [sectionId, userId, req.user.id]);
      }
      await audit({ userId: req.user.id, entityType: 'project_section', entityId: sectionId, action: 'assign_members', metadata: { projectId, memberIds }, connection });
      await connection.commit();
      res.json({ message: 'تیم برنامه‌نویسی این بخش ذخیره شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }),
);


router.put(
  '/:id/members',
  [
    body('memberIds').isArray({ max: 500 }).withMessage('فهرست اعضای پروژه معتبر نیست.'),
    body('memberIds.*').optional().isInt({ min: 1 }).withMessage('شناسه عضو معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const project = await requireProjectManagerAccess(req, res, projectId);
    if (!project) return;

    const requestedIds = [...new Set((req.body.memberIds || []).map(Number).filter(Boolean))]
      .filter((id) => Number(id) !== Number(project.manager_id));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (requestedIds.length) {
        const placeholders = requestedIds.map(() => '?').join(',');
        const [validRows] = await connection.execute(
          `SELECT id FROM users
           WHERE id IN (${placeholders}) AND is_active = 1
             AND (role IN ('developer', 'project_manager') OR manager_access = 1)`,
          requestedIds,
        );
        if (validRows.length !== requestedIds.length) {
          await connection.rollback();
          return res.status(400).json({ message: 'اعضای پروژه باید برنامه‌نویس یا مدیر پروژه فعال باشند.' });
        }
      }

      const [currentRows] = await connection.execute(
        'SELECT user_id FROM project_members WHERE project_id = ? FOR UPDATE',
        [projectId],
      );
      const currentIds = currentRows.map((row) => Number(row.user_id)).filter((id) => id !== Number(project.manager_id));
      const removedIds = currentIds.filter((id) => !requestedIds.includes(id));
      if (removedIds.length) {
        const placeholders = removedIds.map(() => '?').join(',');
        const [blocked] = await connection.execute(
          `SELECT DISTINCT assignee_id FROM tasks
           WHERE project_id = ? AND assignee_id IN (${placeholders}) AND status <> 'done'`,
          [projectId, ...removedIds],
        );
        if (blocked.length) {
          await connection.rollback();
          return res.status(409).json({ message: 'ابتدا تسک‌های باز اعضایی که می‌خواهید از پروژه حذف کنید به فرد دیگری منتقل کنید.' });
        }
        await connection.execute(
          `DELETE psm FROM project_section_members psm
           JOIN project_sections ps ON ps.id = psm.section_id
           WHERE ps.project_id = ? AND psm.user_id IN (${placeholders})`,
          [projectId, ...removedIds],
        );
      }

      await connection.execute('DELETE FROM project_members WHERE project_id = ?', [projectId]);
      for (const memberId of requestedIds) {
        await connection.execute(
          'INSERT IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)',
          [projectId, memberId],
        );
      }
      const addedIds = requestedIds.filter((id) => !currentIds.includes(id));
      await audit({
        userId: req.user.id,
        entityType: 'project',
        entityId: projectId,
        action: 'update_members',
        metadata: { memberIds: requestedIds },
        connection,
      });
      if (addedIds.length) {
        await notifyMany({
          userIds: addedIds,
          type: 'project_membership',
          title: 'به تیم پروژه اضافه شدید',
          message: 'عضویت شما در تیم پروژه ثبت شد.',
          entityType: 'project',
          entityId: projectId,
          connection,
        });
      }
      await connection.commit();
      res.json({ message: 'اعضای پروژه به‌روزرسانی شدند.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

router.delete('/:id/sections/:sectionId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);
  const sectionId = Number(req.params.sectionId);
  const project = await requireProjectManagerAccess(req, res, projectId);
  if (!project) return;
  const [result] = await pool.execute('DELETE FROM project_sections WHERE id = ? AND project_id = ?', [sectionId, projectId]);
  if (!result.affectedRows) return res.status(404).json({ message: 'بخش پروژه پیدا نشد.' });
  await audit({ userId: req.user.id, entityType: 'project_section', entityId: sectionId, action: 'delete', metadata: { projectId } });
  res.json({ message: 'بخش حذف شد؛ تسک‌های آن در قسمت «بدون بخش» باقی ماندند.' });
}));

router.post(
  '/',
  authorize('admin', 'project_manager'),
  [
    body('name').trim().isLength({ min: 2, max: 160 }).withMessage('نام پروژه معتبر نیست.'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('توضیحات پروژه طولانی است.'),
    body('code').optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 40 }).matches(/^[A-Za-z0-9_-]+$/).withMessage('کد پروژه فقط می‌تواند شامل حروف، عدد، خط تیره و زیرخط باشد.'),
    body('managerId').optional().isInt({ min: 1 }).withMessage('مدیر پروژه معتبر نیست.'),
    body('status').optional().isIn(statuses).withMessage('وضعیت معتبر نیست.'),
    body('memberIds').optional().isArray({ max: 500 }).withMessage('اعضای پروژه معتبر نیستند.'),
    body('memberIds.*').optional().isInt({ min: 1 }).withMessage('شناسه عضو معتبر نیست.'),
    body('startDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('تاریخ شروع معتبر نیست.'),
    body('targetDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('تاریخ هدف معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, description, memberIds = [], status = 'planning', startDate, targetDate } = req.body;
    const requestedManagerId = req.body.managerId;
    const managerId = req.user.role === 'project_manager' ? Number(req.user.id) : Number(requestedManagerId);
    const code = req.body.code?.trim().toUpperCase() || `PRJ-${Date.now().toString(36).toUpperCase()}`;
    if (req.user.role === 'admin' && (!Number.isInteger(managerId) || managerId < 1)) {
      return res.status(422).json({ message: 'مدیر پروژه الزامی است.' });
    }
    if (startDate && targetDate && startDate > targetDate) return res.status(422).json({ message: 'تاریخ هدف نمی‌تواند قبل از تاریخ شروع باشد.' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [managerRows] = await connection.execute("SELECT id FROM users WHERE id = ? AND (role = 'project_manager' OR manager_access = 1) AND is_active = 1", [managerId]);
      if (!managerRows[0]) {
        await connection.rollback();
        return res.status(400).json({ message: 'مدیر پروژه انتخاب‌شده معتبر نیست.' });
      }
      const uniqueMembers = [...new Set(memberIds.map(Number).filter(Boolean))];
      if (uniqueMembers.length) {
        const placeholders = uniqueMembers.map(() => '?').join(',');
        const [validMembers] = await connection.execute(
          `SELECT id FROM users WHERE id IN (${placeholders}) AND is_active = 1 AND (role IN ('developer', 'project_manager') OR manager_access = 1)`,
          uniqueMembers,
        );
        if (validMembers.length !== uniqueMembers.length) {
          await connection.rollback();
          return res.status(400).json({ message: 'اعضای انتخاب‌شده باید برنامه‌نویس یا مدیر پروژه فعال باشند.' });
        }
      }
      const [result] = await connection.execute(
        `INSERT INTO projects (name, code, description, manager_id, status, start_date, target_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, code, description || null, managerId, status, startDate || null, targetDate || null],
      );
      for (const memberId of uniqueMembers) {
        await connection.execute(
          `INSERT IGNORE INTO project_members (project_id, user_id)
           SELECT ?, id FROM users WHERE id = ? AND is_active = 1 AND (role IN ('developer', 'project_manager') OR manager_access = 1) AND id <> ?`,
          [result.insertId, memberId, managerId],
        );
      }
      await audit({ userId: req.user.id, entityType: 'project', entityId: result.insertId, action: 'create', metadata: { name, managerId }, connection });
      await notifyMany({
        userIds: [managerId, ...uniqueMembers],
        type: 'project_membership',
        title: 'عضویت در پروژه جدید',
        message: `${name} (${code})`,
        entityType: 'project',
        entityId: result.insertId,
        connection,
      });
      await connection.commit();
      res.status(201).json({ message: 'پروژه ایجاد شد.', id: result.insertId });
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
  authorize('admin', 'project_manager'),
  [
    body('name').optional().trim().isLength({ min: 2, max: 160 }).withMessage('نام پروژه معتبر نیست.'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 10000 }).withMessage('توضیحات پروژه طولانی است.'),
    body('code').optional().trim().isLength({ min: 2, max: 40 }).matches(/^[A-Za-z0-9_-]+$/).withMessage('کد پروژه معتبر نیست.'),
    body('managerId').optional().isInt({ min: 1 }).withMessage('مدیر پروژه معتبر نیست.'),
    body('status').optional().isIn(statuses).withMessage('وضعیت معتبر نیست.'),
    body('memberIds').optional().isArray({ max: 500 }).withMessage('اعضا معتبر نیستند.'),
    body('memberIds.*').optional().isInt({ min: 1 }).withMessage('شناسه عضو معتبر نیست.'),
    body('startDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('تاریخ شروع معتبر نیست.'),
    body('targetDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('تاریخ هدف معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const [access] = await pool.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
    const project = access[0];
    if (!project) return res.status(404).json({ message: 'پروژه پیدا نشد.' });
    if (req.user.role === 'project_manager' && Number(project.manager_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'فقط مدیر همین پروژه می‌تواند آن را ویرایش کند.' });
    }
    if (req.user.role === 'project_manager' && Object.prototype.hasOwnProperty.call(req.body, 'managerId')) {
      return res.status(403).json({ message: 'تغییر مدیر پروژه فقط توسط ادمین انجام می‌شود.' });
    }
    const editableKeys = ['name', 'code', 'description', 'managerId', 'status', 'startDate', 'targetDate', 'memberIds'];
    if (!editableKeys.some((key) => Object.prototype.hasOwnProperty.call(req.body, key))) {
      return res.status(400).json({ message: 'تغییری ارسال نشده است.' });
    }
    const startDate = Object.prototype.hasOwnProperty.call(req.body, 'startDate') ? req.body.startDate : project.start_date;
    const targetDate = Object.prototype.hasOwnProperty.call(req.body, 'targetDate') ? req.body.targetDate : project.target_date;
    if (startDate && targetDate && startDate > targetDate) return res.status(422).json({ message: 'تاریخ هدف نمی‌تواند قبل از تاریخ شروع باشد.' });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM projects WHERE id = ? FOR UPDATE', [projectId]);
      if (['completed', 'archived'].includes(req.body.status)) {
        const [[openTasks]] = await connection.execute(
          "SELECT COUNT(*) AS total FROM tasks WHERE project_id = ? AND status <> 'done'",
          [projectId],
        );
        if (Number(openTasks.total)) {
          await connection.rollback();
          return res.status(409).json({ message: 'تا زمانی که تسک باز وجود دارد، پروژه قابل تکمیل یا آرشیو نیست.' });
        }
      }
      if (req.body.managerId) {
        const [managerRows] = await connection.execute("SELECT id FROM users WHERE id = ? AND (role = 'project_manager' OR manager_access = 1) AND is_active = 1", [req.body.managerId]);
        if (!managerRows[0]) {
          await connection.rollback();
          return res.status(400).json({ message: 'مدیر پروژه انتخاب‌شده معتبر نیست.' });
        }
      }
      const mapping = {
        name: 'name', code: 'code', description: 'description', managerId: 'manager_id', status: 'status', startDate: 'start_date', targetDate: 'target_date',
      };
      const fields = [];
      const values = [];
      for (const [key, column] of Object.entries(mapping)) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          fields.push(`${column} = ?`);
          let value = req.body[key];
          if (key === 'code' && value) value = value.toUpperCase();
          values.push(value === '' ? null : value);
        }
      }
      if (fields.length) {
        values.push(projectId);
        await connection.execute(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, values);
      }
      let addedMembers = [];
      if (Array.isArray(req.body.memberIds)) {
        const nextMembers = [...new Set(req.body.memberIds.map(Number).filter(Boolean))];
        if (nextMembers.length) {
          const placeholders = nextMembers.map(() => '?').join(',');
          const [validMembers] = await connection.execute(
            `SELECT id FROM users WHERE id IN (${placeholders}) AND is_active = 1 AND (role IN ('developer', 'project_manager') OR manager_access = 1)`,
            nextMembers,
          );
          if (validMembers.length !== nextMembers.length) {
            await connection.rollback();
            return res.status(400).json({ message: 'اعضای انتخاب‌شده باید برنامه‌نویس یا مدیر پروژه فعال باشند.' });
          }
        }
        const [currentRows] = await connection.execute('SELECT user_id FROM project_members WHERE project_id = ?', [projectId]);
        const currentMembers = currentRows.map((row) => Number(row.user_id));
        const removedMembers = currentMembers.filter((id) => !nextMembers.includes(id));
        if (removedMembers.length) {
          const placeholders = removedMembers.map(() => '?').join(',');
          const [blocked] = await connection.execute(
            `SELECT DISTINCT assignee_id FROM tasks WHERE project_id = ? AND assignee_id IN (${placeholders}) AND status <> 'done'`,
            [projectId, ...removedMembers],
          );
          if (blocked.length) {
            await connection.rollback();
            return res.status(409).json({ message: 'ابتدا تسک‌های باز اعضایی که می‌خواهید حذف کنید را به فرد دیگری تخصیص دهید.' });
          }
        }
        await connection.execute('DELETE FROM project_members WHERE project_id = ?', [projectId]);
        for (const memberId of nextMembers) {
          await connection.execute(
            `INSERT IGNORE INTO project_members (project_id, user_id)
             SELECT ?, id FROM users WHERE id = ? AND is_active = 1 AND (role IN ('developer', 'project_manager') OR manager_access = 1) AND id <> ?`,
            [projectId, memberId, Number(req.body.managerId || project.manager_id)],
          );
        }
        addedMembers = nextMembers.filter((id) => !currentMembers.includes(id));
      }
      await audit({ userId: req.user.id, entityType: 'project', entityId: projectId, action: 'update', metadata: req.body, connection });
      if (addedMembers.length) {
        await notifyMany({
          userIds: addedMembers,
          type: 'project_membership',
          title: 'به پروژه اضافه شدید',
          message: req.body.name || project.name,
          entityType: 'project',
          entityId: projectId,
          connection,
        });
      }
      if (req.body.managerId && Number(req.body.managerId) !== Number(project.manager_id)) {
        await notifyMany({
          userIds: [Number(req.body.managerId)],
          type: 'project_management',
          title: 'مدیریت پروژه به شما واگذار شد',
          message: req.body.name || project.name,
          entityType: 'project',
          entityId: projectId,
          connection,
        });
      }
      await connection.commit();
      res.json({ message: 'پروژه به‌روزرسانی شد.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

export default router;
