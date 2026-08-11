import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function resolveAvailableRoles(record) {
  const roles = [record.primary_role];
  // secondary_role is kept only for legacy/private-owner access.
  if (record.secondary_role) roles.push(record.secondary_role);
  if (Boolean(record.manager_access)) roles.push('project_manager');
  if (Boolean(record.admin_access)) roles.push('admin');
  return [...new Set(roles.filter(Boolean))];
}

export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: 'برای ادامه وارد حساب شوید.' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'نشست شما منقضی یا نامعتبر است.' });
  }

  const [rows] = await pool.execute(
    `SELECT id, full_name, username, email, role AS primary_role, secondary_role,
      manager_access, admin_access, task_assignment_access, is_active
     FROM users WHERE id = ? LIMIT 1`,
    [payload.sub],
  );

  const record = rows[0];
  if (!record || !record.is_active) return res.status(401).json({ message: 'حساب کاربری فعال نیست.' });

  const availableRoles = resolveAvailableRoles(record);
  const activeRole = availableRoles.includes(payload.activeRole) ? payload.activeRole : record.primary_role;

  req.user = {
    id: record.id,
    full_name: record.full_name,
    username: record.username,
    email: record.email,
    role: activeRole,
    primary_role: record.primary_role,
    secondary_role: record.secondary_role,
    manager_access: Boolean(record.manager_access),
    admin_access: Boolean(record.admin_access),
    task_assignment_access: Boolean(record.task_assignment_access) || ['admin', 'project_manager'].includes(activeRole),
    available_roles: availableRoles,
    is_active: record.is_active,
  };
  next();
});

export const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'دسترسی لازم برای این عملیات را ندارید.' });
  }
  next();
};
