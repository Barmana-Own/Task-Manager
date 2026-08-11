SET NAMES utf8mb4;
SET @schema_name = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'task_assignment_access') = 0,
  'ALTER TABLE users ADD COLUMN task_assignment_access TINYINT(1) NOT NULL DEFAULT 0 AFTER admin_access',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE users
SET task_assignment_access = 1
WHERE role IN ('admin', 'project_manager')
   OR LOWER(REPLACE(username, '@', '')) = 'senior_developer';
