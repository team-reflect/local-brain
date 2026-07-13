-- Normalize task-status values emitted by earlier desktop builds.
-- Scheduling is a date dimension (`scheduled_for`), not a lifecycle status.
UPDATE tasks
SET status = 'cancelled'
WHERE lower(trim(status)) = 'canceled';

UPDATE tasks
SET status = 'open'
WHERE lower(trim(status)) = 'scheduled';

UPDATE tasks
SET status = 'in_progress'
WHERE lower(trim(status)) IN ('in progress', 'in-progress');
