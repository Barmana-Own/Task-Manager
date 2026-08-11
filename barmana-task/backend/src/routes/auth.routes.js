import { Router } from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';

const router = Router();

function resolveAvailableRoles(record) {
  const roles = [record.primary_role];
  // Legacy/private-owner secondary access remains supported without being exposed
  // as the explicit admin_access setting in the users table.
  if (record.secondary_role) roles.push(record.secondary_role);
  if (Boolean(record.manager_access)) roles.push('project_manager');
  if (Boolean(record.admin_access)) roles.push('admin');
  return [...new Set(roles.filter(Boolean))];
}

function buildSessionUser(record, activeRole) {
  const availableRoles = resolveAvailableRoles(record);
  const safeActiveRole = availableRoles.includes(activeRole) ? activeRole : record.primary_role;
  return {
    id: record.id,
    full_name: record.full_name,
    username: record.username,
    email: record.email,
    role: safeActiveRole,
    primary_role: record.primary_role,
    secondary_role: record.secondary_role,
    manager_access: Boolean(record.manager_access),
    admin_access: Boolean(record.admin_access),
    task_assignment_access: Boolean(record.task_assignment_access) || ['admin', 'project_manager'].includes(safeActiveRole),
    available_roles: availableRoles,
    is_active: record.is_active,
  };
}

function signSession(user) {
  return jwt.sign(
    { sub: user.id, activeRole: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );
}

router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('نام کاربری الزامی است.'),
    body('password').isLength({ min: 6 }).withMessage('رمز عبور معتبر نیست.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const [rows] = await pool.execute(
      `SELECT id, full_name, username, email, role AS primary_role, secondary_role,
        manager_access, admin_access, task_assignment_access, is_active, password_hash
       FROM users WHERE username = ? LIMIT 1`,
      [username],
    );
    const record = rows[0];
    if (!record || !record.is_active || !(await bcrypt.compare(password, record.password_hash))) {
      return res.status(401).json({ message: 'نام کاربری یا رمز عبور اشتباه است.' });
    }
    const user = buildSessionUser(record, record.primary_role);
    const token = signSession(user);
    await pool.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await audit({ userId: user.id, entityType: 'auth', action: 'login', metadata: { activeRole: user.role } });
    res.json({ token, user });
  }),
);

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.post(
  '/switch-role',
  authenticate,
  [body('activeRole').isIn(['admin', 'project_manager', 'developer']).withMessage('نقش انتخاب‌شده معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
    const requestedRole = req.body.activeRole;
    if (!req.user.available_roles.includes(requestedRole)) {
      return res.status(403).json({ message: 'این فضای کاری برای حساب شما فعال نشده است.' });
    }
    const previousRole = req.user.role;
    const user = { ...req.user, role: requestedRole };
    const token = signSession(user);
    await audit({
      userId: user.id,
      entityType: 'auth',
      action: 'switch_role',
      metadata: { from: previousRole, to: requestedRole },
    });
    res.json({ token, user, message: 'فضای کاری تغییر کرد.' });
  }),
);

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').isLength({ min: 6 }).withMessage('رمز عبور فعلی معتبر نیست.'),
    body('newPassword').matches(/^\d{8,20}$/).withMessage('رمز عبور جدید باید فقط عدد و بین ۸ تا ۲۰ رقم باشد.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(req.body.currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ message: 'رمز عبور فعلی صحیح نیست.' });
    }
    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
    await audit({ userId: req.user.id, entityType: 'auth', action: 'change_password' });
    res.json({ message: 'رمز عبور با موفقیت تغییر کرد.' });
  }),
);

export default router;
