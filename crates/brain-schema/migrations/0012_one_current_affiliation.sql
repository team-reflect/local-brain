-- Enforce a single current employer per person at the database level, mirroring
-- the CLI's upsert_affiliation invariant so ANY writer (the `brain` CLI or the
-- desktop core) fails loud instead of silently recording two current affiliations.
-- Modeled on idx_people_self (at most one is_self person).

-- 1. Demote pre-existing duplicates: keep the most-recently-updated current
--    affiliation per person (ties broken by id), clearing is_current on the rest.
UPDATE affiliations
SET is_current = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_current = 1
  AND EXISTS (
    SELECT 1 FROM affiliations other
    WHERE other.person_id = affiliations.person_id
      AND other.is_current = 1
      AND (
        other.updated_at > affiliations.updated_at
        OR (other.updated_at = affiliations.updated_at AND other.id > affiliations.id)
      )
  );

-- 2. Keep the denormalized people.current_organization_id consistent with the one
--    surviving current affiliation (only for people who have one).
UPDATE people
SET current_organization_id = (
      SELECT organization_id FROM affiliations
      WHERE affiliations.person_id = people.id AND affiliations.is_current = 1
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1 FROM affiliations
  WHERE affiliations.person_id = people.id AND affiliations.is_current = 1
);

-- 3. Enforce the invariant going forward.
CREATE UNIQUE INDEX idx_affiliations_one_current
  ON affiliations (person_id) WHERE is_current = 1;
