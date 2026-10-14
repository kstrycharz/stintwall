"""Run with python -m unittest discover -s tests -p 'test_*.py'."""
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import server


class StorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        server.DB = Path(cls.temp.name) / 'test.sqlite3'
        server.TRACK_MAPS = Path(cls.temp.name) / 'track-maps'
        server.TRACK_MAPS.mkdir()
        with sqlite3.connect(server.DB) as db:
            db.execute('CREATE TABLE plan (id INTEGER PRIMARY KEY, revision INTEGER, body TEXT)')
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.http.server_port}/api/plan'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def setUp(self):
        with sqlite3.connect(server.DB) as db:
            db.execute('DELETE FROM plan')

    def put(self, value, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        request = Request(self.url, data=json.dumps(value).encode(), headers=headers, method='PUT')
        try:
            with urlopen(request) as r:
                return r.status, json.load(r)
        except HTTPError as e:
            return e.code, json.load(e)

    def test_round_trip_and_revision(self):
        plan = {'schema': 1, 'drivers': [], 'stints': [], 'name': 'Night race'}
        self.assertEqual(self.put({'revision': 0, 'plan': plan}), (200, {'revision': 1}))
        with urlopen(self.url) as r:
            self.assertEqual(json.load(r), {'revision': 1, 'plan': plan})
        with sqlite3.connect(server.DB) as db:
            self.assertEqual(json.loads(db.execute('SELECT body FROM plan').fetchone()[0]), plan)

    def test_conflicting_window_cannot_overwrite(self):
        value = {'revision': 0, 'plan': {'schema': 1, 'drivers': [], 'stints': []}}
        self.assertEqual(self.put(value)[0], 200)
        self.assertEqual(self.put(value)[0], 409)

    def test_invalid_plan_is_rejected(self):
        self.assertEqual(self.put({'revision': 0, 'plan': 'bad'})[0], 400)

    def test_original_workbook_download_is_byte_identical(self):
        source = next(server.ROOT.glob('*.xlsx'))
        url = f'http://127.0.0.1:{self.http.server_port}/api/source-workbook'
        with urlopen(url) as response:
            self.assertEqual(response.read(), source.read_bytes())
            self.assertIn('spreadsheetml.sheet', response.headers['Content-Type'])

    def test_cross_origin_write_is_rejected(self):
        value = {'revision': 0, 'plan': {'schema': 1, 'drivers': [], 'stints': []}}
        self.assertEqual(self.put(value, 'https://unrelated.example')[0], 403)

    def test_track_map_cache_is_served_by_numeric_track_id(self):
        expected = {'schema': 1, 'trackId': 523, 'active': {'points': []}}
        (server.TRACK_MAPS / '523.json').write_text(json.dumps(expected), encoding='utf-8')
        url = f'http://127.0.0.1:{self.http.server_port}/api/track-map/523'
        with urlopen(url) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response), expected)

        with self.assertRaises(HTTPError) as missing:
            urlopen(f'http://127.0.0.1:{self.http.server_port}/api/track-map/999')
        self.assertEqual(missing.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
