SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS task_reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  developer_id BIGINT UNSIGNED NOT NULL,
  on_time TINYINT UNSIGNED NOT NULL,
  responsibility TINYINT UNSIGNED NOT NULL,
  speed TINYINT UNSIGNED NOT NULL,
  accuracy TINYINT UNSIGNED NOT NULL,
  quality TINYINT UNSIGNED NOT NULL,
  communication TINYINT UNSIGNED NOT NULL,
  problem_solving TINYINT UNSIGNED NOT NULL,
  documentation TINYINT UNSIGNED NOT NULL,
  average_score DECIMAL(4,2) NOT NULL,
  summary_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_reviews_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_reviews_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_reviews_developer FOREIGN KEY (developer_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_task_reviews_developer_created (developer_id, created_at),
  INDEX idx_task_reviews_project_created (project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
