-- Collapse duplicate project relationship storage.
--
-- `tasks.project_id` is the canonical project-task association for launch.
-- Historical `project_tasks` rows are backfilled into tasks that do not already
-- have a project, then the duplicate join table is removed. The mirror
-- `document_projects` and `interaction_projects` tables were never used by the
-- app; `project_documents` and `project_interactions` are the canonical tables.

UPDATE tasks
SET project_id = (
  SELECT project_tasks.project_id
  FROM project_tasks
  WHERE project_tasks.task_id = tasks.id
  ORDER BY project_tasks.created_at ASC, project_tasks.id ASC
  LIMIT 1
)
WHERE project_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM project_tasks
    WHERE project_tasks.task_id = tasks.id
  );

DROP TABLE project_tasks;
DROP TABLE document_projects;
DROP TABLE interaction_projects;
