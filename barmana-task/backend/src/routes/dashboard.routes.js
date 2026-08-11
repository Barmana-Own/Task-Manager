import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const role = req.user.role;
  let projectWhere = '';
  let taskWhere = '';
  const projectParams = [];
  const taskParams = [];

  if (role === 'project_manager') {
    projectWhere = 'WHERE p.manager_id = ?';
    taskWhere = 'WHERE p.manager_id = ?';
    projectParams.push(req.user.id);
    taskParams.push(req.user.id);
  } else if (role === 'developer') {
    projectWhere = `WHERE EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?)`;
    taskWhere = 'WHERE t.assignee_id = ?';
    projectParams.push(req.user.id);
    taskParams.push(req.user.id);
  }

  const [[projectStats], [taskStats], [recentTasks]] = await Promise.all([
    pool.execute(
      `SELECT COUNT(*) AS total_projects,
        SUM(p.status = 'active') AS active_projects,
        SUM(p.status = 'completed') AS completed_projects
       FROM projects p ${projectWhere}`,
      projectParams,
    ),
    pool.execute(
      `SELECT COUNT(*) AS total_tasks,
        SUM(t.status = 'todo') AS todo_tasks,
        SUM(t.status = 'in_progress') AS in_progress_tasks,
        SUM(t.status = 'review') AS review_tasks,
        SUM(t.status = 'done') AS done_tasks,
        SUM(t.due_date < CURDATE() AND t.status <> 'done') AS overdue_tasks,
        COALESCE(SUM(COALESCE(tt.tracked_seconds, 0)), 0) AS tracked_seconds
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN (
         SELECT task_id, SUM(duration_seconds) AS tracked_seconds
         FROM timer_sessions GROUP BY task_id
       ) tt ON tt.task_id = t.id
       ${taskWhere}`,
      taskParams,
    ),
    pool.execute(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name,
        a.full_name AS assignee_name
       FROM tasks t JOIN projects p ON p.id = t.project_id
       LEFT JOIN users a ON a.id = t.assignee_id
       ${taskWhere}
       ORDER BY t.updated_at DESC LIMIT 8`,
      taskParams,
    ),
  ]);

  let admin = null;
  if (role === 'admin') {
    const [[userRows], [timerRows], [activityRows]] = await Promise.all([
      pool.execute(
        `SELECT COUNT(*) AS total_users,
          SUM(role = 'project_manager' AND is_active = 1) AS managers,
          SUM(role = 'developer' AND is_active = 1) AS developers,
          SUM(is_active = 0) AS inactive_users FROM users`,
      ),
      pool.execute(
        `SELECT ts.id, ts.started_at, TIMESTAMPDIFF(SECOND, ts.started_at, NOW()) AS live_seconds,
          u.full_name AS user_name, t.title AS task_title, p.name AS project_name
         FROM timer_sessions ts
         JOIN users u ON u.id = ts.user_id
         JOIN tasks t ON t.id = ts.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE ts.ended_at IS NULL ORDER BY ts.started_at`,
      ),
      pool.execute(
        `SELECT a.*, u.full_name AS user_name FROM activity_logs a
         LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 10`,
      ),
    ]);
    admin = { users: userRows[0], activeTimers: timerRows, recentActivities: activityRows };
  }

  res.json({
    stats: { ...projectStats[0], ...taskStats[0] },
    recentTasks,
    admin,
  });
}));

export default router;
