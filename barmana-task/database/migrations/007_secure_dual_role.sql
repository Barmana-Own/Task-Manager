SET NAMES utf8mb4;

ALTER TABLE users
  ADD COLUMN secondary_role ENUM('admin', 'project_manager', 'developer') NULL AFTER role;

UPDATE users
SET secondary_role = 'admin'
WHERE LOWER(username) = 'senior_developer'
  AND role <> 'admin';

INSERT INTO activity_logs (user_id, entity_type, entity_id, action, metadata)
SELECT id, 'user', id, 'secondary_role_granted',
       JSON_OBJECT('secondaryRole', 'admin', 'source', 'migration_007')
FROM users
WHERE LOWER(username) = 'senior_developer'
  AND secondary_role = 'admin';
