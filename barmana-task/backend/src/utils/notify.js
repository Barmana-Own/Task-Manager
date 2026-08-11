import pool from '../config/db.js';

export async function notify({ userId, type, title, message, entityType = null, entityId = null, connection = pool }) {
  if (!userId) return;
  await connection.execute(
    `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, title, message, entityType, entityId],
  );
}

export async function notifyMany({ userIds, ...payload }) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(Number))];
  for (const userId of uniqueIds) {
    await notify({ ...payload, userId });
  }
}
