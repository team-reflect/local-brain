-- Network strength is derived relationship intelligence, not writable person state.
-- Existing databases had people.relationship_strength from the launch schema; remove
-- it and expose deterministic read-side values through a normal SQLite view.

ALTER TABLE people DROP COLUMN relationship_strength;

CREATE VIEW relationship_strengths AS
WITH signals AS (
  SELECT
    people.id AS person_id,
    COUNT(DISTINCT CASE
      WHEN interactions.archived_at IS NULL
       AND interactions.occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')
      THEN interactions.id
    END) AS recent_interactions,
    CAST(julianday('now') - julianday(MAX(CASE
      WHEN interactions.archived_at IS NULL AND interactions.occurred_at IS NOT NULL
      THEN interactions.occurred_at
    END)) AS INTEGER) AS days_since_last,
    COUNT(DISTINCT CASE
      WHEN tasks.archived_at IS NULL AND tasks.status != 'done'
      THEN tasks.id
    END) AS open_tasks
  FROM people
  LEFT JOIN interaction_participants ON interaction_participants.person_id = people.id
  LEFT JOIN interactions ON interactions.id = interaction_participants.interaction_id
  LEFT JOIN task_people ON task_people.person_id = people.id
  LEFT JOIN tasks ON tasks.id = task_people.task_id
  WHERE people.is_self = 0 AND people.archived_at IS NULL
  GROUP BY people.id
),
scores AS (
  SELECT
    person_id,
    recent_interactions,
    days_since_last,
    open_tasks,
    min(recent_interactions, 5)
      + CASE
          WHEN days_since_last IS NULL THEN 0
          WHEN days_since_last <= 30 THEN 3
          WHEN days_since_last <= 90 THEN 2
          WHEN days_since_last <= 180 THEN 1
          ELSE 0
        END
      + min(open_tasks, 2) AS score
  FROM signals
)
SELECT
  person_id,
  CASE
    WHEN recent_interactions = 0 AND open_tasks = 0 THEN NULL
    WHEN score >= 8 THEN 5
    WHEN score >= 6 THEN 4
    WHEN score >= 4 THEN 3
    WHEN score >= 2 THEN 2
    ELSE 1
  END AS relationship_strength,
  recent_interactions,
  days_since_last,
  open_tasks
FROM scores;
