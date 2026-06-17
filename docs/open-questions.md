# Open Questions

These are the questions to answer before implementation starts.

## Product

1. What is the first audience?
   - Agent-native power users?
   - Reflect users?
   - Founders/operators?
   - General consumers?

2. What is the right name?
   - Local Brain is only a working name.

3. Should the app feel more like:
   - a personal assistant memory,
   - a private knowledge graph,
   - a life/work command center,
   - or an agent data layer?

4. Is daily planning a first-class product surface, or just one view over memory?

5. Should the user write notes directly in the app, or should sources mostly come from
   files, transcripts, and agents?

## Technical

1. Should the first implementation fork Reflect Open or start as a new repo that copies
   selected packages/patterns?

2. Should the SQLite DB live in:
   - an app-managed folder,
   - a user-chosen "brain" folder,
   - or a package containing DB plus imported source files?

3. Should raw imported files be copied into a local sources folder, referenced in place,
   or both?

4. Should vectors ship in v1, or should v1 use FTS5 plus stored embeddings until vector
   search is distribution-safe?

5. Should the app have a local HTTP API, or is the CLI enough for agent integration at
   launch?

6. How much of Reflect Open's markdown editor should be retained if markdown is not the
   source of truth?

7. Should backups be:
   - SQLite file copy,
   - JSON export,
   - Litestream-style snapshots,
   - Git snapshots,
   - or a combination?

## Schema

1. Are generic `entities` enough for launch, or do people/projects need typed profile
   tables immediately?

2. Should `memories` be atomic claims only, or can longer summaries live there too?

3. Should tasks be a first-class durable table from day one?

4. What privacy states are clear enough for users?

5. What correction flow is clear enough when the user spots a wrong memory?

6. How should contradictory memories be represented?

7. Should "forgetting" delete data, archive data, or tombstone it?

## Agent Behavior

1. Which destructive agent writes should require explicit user confirmation?

2. How should agents expose confidence without making the product feel fussy?

3. Should agent skills be installed automatically or offered as explicit setup steps?

4. Which agents should be supported first?

5. Should the CLI ever call a model, or should it only retrieve context and let the
   calling agent/model answer?

## Trust

1. What is the simplest UI for showing citations?

2. What is the simplest UI for showing whether context left the machine?

3. How does a user delete a source and all derived memories?

4. How should the app explain local embeddings and model downloads?

5. What does "private" mean in a product where local agents can read the DB?
