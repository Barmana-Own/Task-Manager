import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

if (String(process.env.SEED_DEMO || '').toLowerCase() !== 'true') {
  console.log('Demo seed skipped (SEED_DEMO is not true).');
  process.exit(0);
}

let inTransaction = false;
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'technical_task_manager',
});

try {
  const [existing] = await connection.execute("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
  if (existing[0]) {
    console.log('Demo data already exists; seed skipped.');
    process.exitCode = 0;
  } else {
    await connection.beginTransaction();
    inTransaction = true;
    const [adminHash, managerHash, developerHash] = await Promise.all([
      bcrypt.hash('Admin123!', 12), bcrypt.hash('Manager123!', 12), bcrypt.hash('Developer123!', 12),
    ]);
    await connection.execute(
      `INSERT INTO users (full_name, username, email, password_hash, role) VALUES
       ('مدیر سامانه', 'admin', 'admin@example.com', ?, 'admin'),
       ('مدیر پروژه نمونه', 'manager', 'manager@example.com', ?, 'project_manager'),
       ('برنامه‌نویس فرانت‌اند', 'developer', 'developer@example.com', ?, 'developer'),
       ('برنامه‌نویس بک‌اند', 'developer2', 'developer2@example.com', ?, 'developer')`,
      [adminHash, managerHash, developerHash, developerHash],
    );
    const [users] = await connection.query("SELECT id, username FROM users WHERE username IN ('admin','manager','developer','developer2')");
    const ids = Object.fromEntries(users.map((user) => [user.username, user.id]));
    const [projectResult] = await connection.execute(
      `INSERT INTO projects (name, code, description, manager_id, status, start_date, target_date)
       VALUES ('سامانه مدیریت تسک فنی', 'TTM-001', 'پروژه نمونه برای بررسی جریان کامل سامانه', ?, 'active', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY))`,
      [ids.manager],
    );
    const projectId = projectResult.insertId;
    await connection.execute('INSERT INTO project_members (project_id, user_id) VALUES (?, ?), (?, ?)', [projectId, ids.developer, projectId, ids.developer2]);
    const [taskResult] = await connection.execute(
      `INSERT INTO tasks (project_id, sequence_no, title, description, assignee_id, created_by, priority, status, due_date, estimated_minutes)
       VALUES (?, 1, 'طراحی داشبورد نقش‌ها', 'داشبورد واکنش‌گرا برای هر سه نقش پیاده‌سازی شود.', ?, ?, 'high', 'in_progress', DATE_ADD(CURDATE(), INTERVAL 4 DAY), 720)`,
      [projectId, ids.developer, ids.manager],
    );
    await connection.execute(
      `INSERT INTO task_checklist_items (task_id, title, sort_order, created_by) VALUES
       (?, 'طراحی وایرفریم داشبورد', 1, ?),
       (?, 'پیاده‌سازی نسخه دسکتاپ', 2, ?),
       (?, 'بررسی نسخه واکنش‌گرا', 3, ?)`,
      [taskResult.insertId, ids.manager, taskResult.insertId, ids.manager, taskResult.insertId, ids.manager],
    );
    await connection.execute(
      `INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?), (?, ?, ?)`,
      [taskResult.insertId, ids.manager, 'لطفاً نسخه موبایل را هم بررسی کن.', taskResult.insertId, ids.developer, 'نسخه واکنش‌گرا در حال تست نهایی است.'],
    );
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
       VALUES (?, 'task_assigned', 'تسک جدید به شما تخصیص داده شد', 'طراحی داشبورد نقش‌ها', 'task', ?)`,
      [ids.developer, taskResult.insertId],
    );
    await connection.execute(
      `INSERT INTO activity_logs (user_id, entity_type, action, metadata)
       VALUES (?, 'system', 'database_seeded', JSON_OBJECT('projectId', ?))`,
      [ids.admin, projectId],
    );
    await connection.commit();
    inTransaction = false;
    console.log('Demo data seeded successfully.');
  }
} catch (error) {
  if (inTransaction) await connection.rollback().catch(() => {});
  throw error;
} finally {
  await connection.end();
}
