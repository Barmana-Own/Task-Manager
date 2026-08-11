import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseName = process.env.DB_NAME || 'technical_task_manager';
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('DB_NAME نامعتبر است.');

const baseConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

const bootstrap = await mysql.createConnection(baseConfig);
try {
  try {
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (error) {
    if (error.code !== 'ER_DBACCESS_DENIED_ERROR' && error.code !== 'ER_ACCESS_DENIED_ERROR') throw error;
  }
} finally {
  await bootstrap.end();
}

const connection = await mysql.createConnection({ ...baseConfig, database: databaseName });
try {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const migrationsDir = path.resolve(__dirname, '../../database/migrations');
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  const [appliedRows] = await connection.query('SELECT migration_name FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.migration_name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    console.log(`Applying migration ${file}...`);
    await connection.query(sql);
    await connection.execute('INSERT INTO schema_migrations (migration_name) VALUES (?)', [file]);
  }
  console.log('Database migrations are up to date.');
} finally {
  await connection.end();
}
