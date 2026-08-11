import { Router } from 'express';
import { query } from 'express-validator';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  [query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('تعداد اعلان‌ها معتبر نیست.')],
  validate,
  asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit || 30);
  const [rows] = await pool.execute(
    `SELECT id, type, title, message, entity_type, entity_id, is_read, created_at, read_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ${limit}`,
    [req.user.id],
  );
  const [[countRow]] = await pool.execute('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ notifications: rows, unread: Number(countRow.unread || 0) });
  }),
);

router.patch('/read-all', asyncHandler(async (req, res) => {
  await pool.execute('UPDATE notifications SET is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ message: 'همه اعلان‌ها خوانده شدند.' });
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  const [result] = await pool.execute(
    'UPDATE notifications SET is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?',
    [Number(req.params.id), req.user.id],
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'اعلان پیدا نشد.' });
  res.json({ message: 'اعلان خوانده شد.' });
}));

export default router;
