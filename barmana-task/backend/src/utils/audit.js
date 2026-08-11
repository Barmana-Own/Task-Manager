import pool from '../config/db.js';

export async function audit({ userId = null, entityType, entityId = null, action, metadata = null, connection = pool }) {
  await connection.execute(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, entityType, entityId, action, metadata ? JSON.stringify(metadata) : null],
  );
}
