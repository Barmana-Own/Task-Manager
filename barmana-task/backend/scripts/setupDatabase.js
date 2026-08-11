import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseName = process.env.DB_NAME || 'technical_task_manager';
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('DB_NAME نامعتبر است.');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${databaseName}\``);
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  await connection.query(schema);

  const [adminHash, managerHash, developerHash, developerTwoHash] = await Promise.all([
    bcrypt.hash('Admin123!', 12),
    bcrypt.hash('Manager123!', 12),
    bcrypt.hash('Developer123!', 12),
    bcrypt.hash('Developer123!', 12),
  ]);

  const [usersResult] = await connection.execute(
    `INSERT INTO users (full_name, username, email, password_hash, role) VALUES
      ('مدیر سامانه', 'admin', 'admin@example.com', ?, 'admin'),
      ('مدیر پروژه نمونه', 'manager', 'manager@example.com', ?, 'project_manager'),
      ('برنامه‌نویس فرانت‌اند', 'developer', 'developer@example.com', ?, 'developer'),
      ('برنامه‌نویس بک‌اند', 'developer2', 'developer2@example.com', ?, 'developer')`,
    [adminHash, managerHash, developerHash, developerTwoHash],
  );

  const [seededUsers] = await connection.query(
    `SELECT id, username FROM users WHERE username IN ('admin', 'manager', 'developer', 'developer2')`,
  );
  const userIds = Object.fromEntries(seededUsers.map((user) => [user.username, user.id]));
  const adminId = userIds.admin;
  const managerId = userIds.manager;
  const developerId = userIds.developer;
  const developerTwoId = userIds.developer2;

  const [projectResult] = await connection.execute(
    `INSERT INTO projects (name, code, description, manager_id, status, start_date, target_date)
     VALUES ('سامانه مدیریت تسک فنی', 'TTM-001', 'پروژه نمونه برای بررسی جریان کامل سامانه', ?, 'active', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY))`,
    [managerId],
  );
  const projectId = projectResult.insertId;

  await connection.execute(
    `INSERT INTO project_members (project_id, user_id) VALUES (?, ?), (?, ?)`,
    [projectId, developerId, projectId, developerTwoId],
  );
  await connection.execute(
    `INSERT INTO tasks (project_id, title, description, assignee_id, created_by, priority, status, due_date, estimated_minutes) VALUES
      (?, 'طراحی داشبورد نقش‌ها', 'داشبورد واکنش‌گرا برای هر سه نقش پیاده‌سازی شود.', ?, ?, 'high', 'in_progress', DATE_ADD(CURDATE(), INTERVAL 4 DAY), 720),
      (?, 'پیاده‌سازی API تایمر', 'شروع و توقف تایمر با جلوگیری از تایمر هم‌زمان.', ?, ?, 'urgent', 'todo', DATE_ADD(CURDATE(), INTERVAL 2 DAY), 480),
      (?, 'مستندسازی استقرار', 'راهنمای Docker و استقرار Production تکمیل شود.', ?, ?, 'medium', 'todo', DATE_ADD(CURDATE(), INTERVAL 7 DAY), 240)`,
    [projectId, developerId, managerId, projectId, developerTwoId, managerId, projectId, developerId, managerId],
  );


  const [seedTasks] = await connection.query(
    `SELECT id, title, assignee_id FROM tasks WHERE project_id = ? ORDER BY id`,
    [projectId],
  );
  if (seedTasks[0]) {
    await connection.execute(
      `INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?), (?, ?, ?)`,
      [
        seedTasks[0].id, managerId, 'لطفاً نسخه موبایل و حالت تایمر فعال را هم در طراحی نهایی بررسی کن.',
        seedTasks[0].id, developerId, 'نسخه واکنش‌گرا آماده شده و بعد از تکمیل تست نهایی ارسال می‌کنم.',
      ],
    );
  }

  await connection.execute(
    `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id) VALUES
      (?, 'project_membership', 'به پروژه اضافه شدید', 'سامانه مدیریت تسک فنی', 'project', ?),
      (?, 'task_assigned', 'تسک جدید به شما تخصیص داده شد', 'طراحی داشبورد نقش‌ها', 'task', ?)` ,
    [developerId, projectId, developerId, seedTasks[0]?.id || null],
  );

  await connection.execute(
    `INSERT INTO activity_logs (user_id, entity_type, entity_id, action, metadata)
     VALUES (?, 'system', NULL, 'database_seeded', JSON_OBJECT('projectId', ?))`,
    [adminId, projectId],
  );

  console.log('Database initialized successfully.');
  console.log('Demo users: admin / manager / developer / developer2');
} finally {
  await connection.end();
}
