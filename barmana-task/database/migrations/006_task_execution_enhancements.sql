SET NAMES utf8mb4;
SET @schema_name = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'sequence_no') = 0,
  'ALTER TABLE tasks ADD COLUMN sequence_no INT UNSIGNED NULL AFTER project_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill deterministic per-project sequence numbers without updating tasks
-- from a directly correlated subquery (keeps this compatible with MySQL/MariaDB).
DROP TEMPORARY TABLE IF EXISTS tmp_task_sequences;
CREATE TEMPORARY TABLE tmp_task_sequences (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  sequence_no INT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT INTO tmp_task_sequences (id, sequence_no)
SELECT current_task.id, COUNT(previous_task.id) AS sequence_no
FROM tasks current_task
JOIN tasks previous_task
  ON previous_task.project_id = current_task.project_id
 AND previous_task.id <= current_task.id
GROUP BY current_task.id;

UPDATE tasks task_row
JOIN tmp_task_sequences numbered ON numbered.id = task_row.id
SET task_row.sequence_no = numbered.sequence_no
WHERE task_row.sequence_no IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_task_sequences;

SET @sql = IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'sequence_no') = 'YES',
  'ALTER TABLE tasks MODIFY COLUMN sequence_no INT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'uq_tasks_project_sequence') = 0,
  'ALTER TABLE tasks ADD UNIQUE INDEX uq_tasks_project_sequence (project_id, sequence_no)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(500) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  completed_by BIGINT UNSIGNED NULL,
  completed_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_checklist_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_checklist_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_checklist_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_task_checklist_task_order (task_id, sort_order, id),
  INDEX idx_task_checklist_completion (task_id, is_completed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_daily_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_daily_reports_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_daily_reports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_task_daily_report (task_id, user_id, report_date),
  INDEX idx_task_daily_reports_task_date (task_id, report_date),
  INDEX idx_task_daily_reports_user_date (user_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
