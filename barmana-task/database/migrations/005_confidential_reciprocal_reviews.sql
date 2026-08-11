SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS manager_reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  manager_id BIGINT UNSIGNED NOT NULL,
  clarity TINYINT UNSIGNED NOT NULL,
  planning TINYINT UNSIGNED NOT NULL,
  communication TINYINT UNSIGNED NOT NULL,
  support TINYINT UNSIGNED NOT NULL,
  availability TINYINT UNSIGNED NOT NULL,
  fairness TINYINT UNSIGNED NOT NULL,
  feedback_quality TINYINT UNSIGNED NOT NULL,
  decision_making TINYINT UNSIGNED NOT NULL,
  average_score DECIMAL(4,2) NOT NULL,
  summary_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_manager_reviews_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_manager_reviews_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_manager_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_manager_reviews_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_manager_reviews_manager_created (manager_id, created_at),
  INDEX idx_manager_reviews_project_created (project_id, created_at),
  INDEX idx_manager_reviews_reviewer_created (reviewer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Approved-task evaluation notes are confidential and live only in task_reviews.
UPDATE tasks SET review_note = NULL WHERE status = 'done';
