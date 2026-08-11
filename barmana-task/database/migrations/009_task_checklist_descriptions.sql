SET NAMES utf8mb4;
SET @schema_name = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name
     AND TABLE_NAME = 'task_checklist_items'
     AND COLUMN_NAME = 'description') = 0,
  'ALTER TABLE task_checklist_items ADD COLUMN description TEXT NULL AFTER title',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
