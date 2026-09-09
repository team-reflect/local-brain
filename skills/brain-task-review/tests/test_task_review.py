"""Behavioral coverage tests with an isolated SQLite fixture; no live brain access."""
import copy
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('task_review', Path(__file__).parents[1] / 'scripts/task_review.py')
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


class TaskReviewTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        with sqlite3.connect(self.root / 'brain.sqlite') as conn:
            conn.executescript('''
                CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT, status TEXT,
                  created_at TEXT, updated_at TEXT, completed_at TEXT, archived_at TEXT,
                  origin_interaction_id TEXT, origin_document_id TEXT);
                CREATE TABLE task_interactions(task_id TEXT, interaction_id TEXT);
                CREATE TABLE task_documents(task_id TEXT, document_id TEXT);
                CREATE TABLE content_chunks(id TEXT, record_type TEXT, record_id TEXT, chunk_index INTEGER, text TEXT);
                CREATE TABLE evidence_refs(id TEXT, subject_type TEXT, subject_id TEXT, chunk_id TEXT, note TEXT);
                INSERT INTO content_chunks VALUES ('chunk', 'interaction', 'source', 0, 'The task is complete.');
            ''')
            for index in range(31):
                task_id = str(index)
                conn.execute("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES (?,?,?,'2026-01-01','2026-01-01')",
                             (task_id, 'Task '+task_id, 'waiting' if index == 30 else 'open'))
                conn.execute("INSERT INTO evidence_refs VALUES (?, 'task', ?, 'chunk', NULL)", (task_id, task_id))
        self.before = review.snapshot(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def ledger(self, current=None):
        current = current or self.before
        return [{'taskId': t['id'], 'outcome': 'kept', 'reason': 'Obligation still outstanding in inspected source.',
                 'checkedSources': ['interaction:source#0'], 'stateDigest': t['stateDigest']}
                for t in current['tasks']]

    def change(self, sql, params=()):
        with sqlite3.connect(self.root / 'brain.sqlite') as conn:
            conn.execute(sql, params)

    def test_snapshot_covers_undated_and_waiting_tasks_beyond_25(self):
        self.assertEqual(self.before['activeCount'], 31)
        self.assertIn('30', self.before['activeIds'])
        self.assertTrue(review.audit(self.before, review.snapshot(self.root), self.ledger())['complete'])

    def test_missing_database_is_not_created(self):
        absent = self.root / 'absent'
        absent.mkdir()
        with self.assertRaises(sqlite3.OperationalError):
            review.snapshot(absent)
        self.assertFalse((absent / 'brain.sqlite').exists())

    def test_missing_duplicate_and_new_tasks_fail_coverage(self):
        self.change("INSERT INTO tasks(id,title,status,created_at) VALUES ('new','New','open','2026-02-01')")
        ledger = self.ledger()[1:]
        ledger.append(copy.deepcopy(ledger[0]))
        result = review.audit(self.before, review.snapshot(self.root), ledger)
        self.assertFalse(result['complete'])
        self.assertIn('new', result['missingTaskIds'])
        self.assertIn(self.before['tasks'][0]['id'], result['missingTaskIds'])
        self.assertTrue(result['errors'])

    def test_wrong_brain_fails(self):
        other = copy.deepcopy(self.before)
        other['brainRoot'] = '/different'
        with self.assertRaisesRegex(ValueError, 'different brain'):
            review.audit(other, self.before, self.ledger())

    def test_stale_readback_and_changed_task_cannot_be_kept(self):
        self.change("UPDATE tasks SET title = 'Changed' WHERE id = '0'")
        current = review.snapshot(self.root)
        self.assertFalse(review.audit(self.before, current, self.ledger())['complete'])
        self.assertFalse(review.audit(self.before, current, self.ledger(current))['complete'])

    def test_done_requires_live_status_timestamp_and_attached_evidence(self):
        ledger = self.ledger()
        entry = next(e for e in ledger if e['taskId'] == '0')
        entry.update(outcome='done', decisionEvidence=['interaction:source#0'])
        self.assertFalse(review.audit(self.before, self.before, ledger)['complete'])
        self.change("UPDATE tasks SET status='done', completed_at='2026-09-09' WHERE id='0'")
        current = review.snapshot(self.root)
        entry['stateDigest'] = current['tasks'][0]['stateDigest']
        self.assertTrue(review.audit(self.before, current, ledger)['complete'])
        entry['decisionEvidence'] = ['interaction:invented#0']
        self.assertFalse(review.audit(self.before, current, ledger)['complete'])

    def test_duplicate_requires_canonical_and_cannot_point_to_self(self):
        self.change("UPDATE tasks SET status='cancelled' WHERE id='0'")
        current = review.snapshot(self.root)
        ledger = self.ledger(current)
        ledger[0].update(outcome='duplicate', canonicalTaskId='1', decisionEvidence=['interaction:source#0'])
        self.assertTrue(review.audit(self.before, current, ledger)['complete'])
        ledger[0]['canonicalTaskId'] = '0'
        self.assertFalse(review.audit(self.before, current, ledger)['complete'])

    def test_unresolved_is_accounted_for_but_not_reviewed_or_complete(self):
        ledger = self.ledger()
        ledger[0].update(outcome='unresolved', checkedSources=[], gap='Provider unavailable')
        result = review.audit(self.before, self.before, ledger)
        self.assertEqual(result['accountedFor'], 31)
        self.assertEqual(result['reviewed'], 30)
        self.assertFalse(result['complete'])

    def test_snapshot_and_audit_do_not_write_database(self):
        path = self.root / 'brain.sqlite'
        before = path.read_bytes()
        review.audit(self.before, review.snapshot(self.root), self.ledger())
        self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
