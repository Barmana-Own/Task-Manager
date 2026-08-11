SET NAMES utf8mb4;

UPDATE users
SET secondary_role = 'admin'
WHERE LOWER(username) = 'senior_developer'
  AND role = 'developer';
