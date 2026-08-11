import pool from '../config/db.js';

export async function getTaskContext(taskId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT t.*, p.manager_id, p.name AS project_name, p.code AS project_code, p.status AS project_status,
      sec.title AS section_title, sec.description AS section_description, sec.sort_order AS section_sort_order,
      a.full_name AS assignee_name, c.full_name AS creator_name, m.full_name AS manager_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_sections sec ON sec.id = t.section_id
     LEFT JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users c ON c.id = t.created_by
     LEFT JOIN users m ON m.id = p.manager_id
     WHERE t.id = ? LIMIT 1`,
    [taskId],
  );
  return rows[0] || null;
}

export function canAccessTask(user, task) {
  if (!task) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'project_manager') return Number(task.manager_id) === Number(user.id);
  return Number(task.assignee_id) === Number(user.id);
}

export async function ensureProjectAccess(user, projectId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT p.id, p.manager_id,
      EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) AS is_member
     FROM projects p WHERE p.id = ? LIMIT 1`,
    [user.id, projectId],
  );
  const project = rows[0];
  if (!project) return { exists: false, allowed: false, project: null };
  const allowed = user.role === 'admin'
    || (user.role === 'project_manager' && (Number(project.manager_id) === Number(user.id) || Boolean(project.is_member)))
    || (user.role === 'developer' && Boolean(project.is_member));
  return { exists: true, allowed, project };
}
