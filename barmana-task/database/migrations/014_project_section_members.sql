SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS project_section_members (
  section_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (section_id, user_id),
  CONSTRAINT fk_project_section_members_section FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_section_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_section_members_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_project_section_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
