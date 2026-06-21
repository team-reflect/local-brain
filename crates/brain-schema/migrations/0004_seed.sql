INSERT INTO sources (id, slug, name, description) VALUES
  ('source_manual', 'manual', 'Manual', 'User-entered or manually curated records.'),
  ('source_agent', 'agent', 'Agent', 'Records created by a local agent without a more specific upstream source.'),
  ('source_gmail', 'gmail', 'Gmail', 'Email messages and attachments sourced from Gmail.'),
  ('source_google_people', 'google_people', 'Google People', 'Contacts sourced from Google People / Contacts.'),
  ('source_google_calendar', 'google_calendar', 'Google Calendar', 'Events sourced from Google Calendar.'),
  ('source_google_meet', 'google_meet', 'Google Meet', 'Meetings or transcripts sourced from Google Meet.'),
  ('source_zoom', 'zoom', 'Zoom', 'Meetings or transcripts sourced from Zoom.'),
  ('source_granola', 'granola', 'Granola', 'Meeting notes and transcripts sourced from Granola.'),
  ('source_file', 'file', 'File', 'Local files imported from disk.'),
  ('source_reflect_notes', 'reflect_notes', 'Reflect Notes', 'Notes imported from a Reflect graph.'),
  ('source_public_web', 'public_web', 'Public Web', 'Public web pages used for enrichment.'),
  ('source_ai_extraction', 'ai_extraction', 'AI Extraction', 'Records created by AI extraction over other sources.');
