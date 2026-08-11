SET NAMES utf8mb4;
SET @schema_name = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'manager_access') = 0,
  'ALTER TABLE users ADD COLUMN manager_access TINYINT(1) NOT NULL DEFAULT 0 AFTER secondary_role',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'admin_access') = 0,
  'ALTER TABLE users ADD COLUMN admin_access TINYINT(1) NOT NULL DEFAULT 0 AFTER manager_access',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Preserve the manager capability introduced in migration 010, but move it out of
-- secondary_role so one account can independently have manager and admin workspaces.
UPDATE users
SET manager_access = 1
WHERE role = 'project_manager' OR secondary_role = 'project_manager';

UPDATE users
SET admin_access = 1
WHERE role = 'admin';

UPDATE users
SET secondary_role = NULL
WHERE secondary_role = 'project_manager';
