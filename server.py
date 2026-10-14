"""Independent, local endurance manager. Python standard library only."""
import argparse
import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'races.sqlite3'
TRACK_MAPS = ROOT / 'data' / 'track-maps'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def reply(self, code, value):
        body = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        request_path = urlsplit(self.path).path
        if request_path == '/api/source-workbook':
            source = next(ROOT.glob('*.xlsx'), None)
            if source is None:
                return self.reply(404, {'error': 'Original workbook not found'})
            body = source.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', 'attachment; filename="original-enduro-workbook.xlsx"')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if request_path == '/api/plan':
            with sqlite3.connect(DB) as db:
                row = db.execute('SELECT revision, body FROM plan WHERE id=1').fetchone()
            return self.reply(200, {'revision': row[0], 'plan': json.loads(row[1])} if row else {'revision': 0, 'plan': None})
        if request_path.startswith('/api/track-map/'):
            track_id = request_path.removeprefix('/api/track-map/')
            if not track_id.isdigit():
                return self.reply(400, {'error': 'Invalid track id'})
            track_map = TRACK_MAPS / f'{track_id}.json'
            if not track_map.is_file():
                return self.reply(404, {'error': 'Track map has not been generated', 'track_id': int(track_id)})
            try:
                return self.reply(200, json.loads(track_map.read_text(encoding='utf-8')))
            except (OSError, ValueError):
                return self.reply(500, {'error': 'Track map cache is unreadable'})
        if request_path == '/api/health':
            return self.reply(200, {'status': 'ok', 'application': 'endurance-manager'})
        super().do_GET()

    def do_PUT(self):
        if self.path != '/api/plan':
            return self.reply(404, {'error': 'Not found'})
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            return self.reply(403, {'error': 'Cross-origin write rejected'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 2_000_000:
                return self.reply(413, {'error': 'Invalid plan size'})
            value = json.loads(self.rfile.read(size))
            plan = value['plan']
            if not isinstance(plan, dict) or plan.get('schema') != 1 or not isinstance(plan.get('drivers'), list) or not isinstance(plan.get('stints'), list):
                raise ValueError('Invalid plan format')
            with sqlite3.connect(DB) as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT revision FROM plan WHERE id=1').fetchone()
                revision = row[0] if row else 0
                if value.get('revision') != revision:
                    return self.reply(409, {'error': 'The plan changed in another window. Reload before saving.'})
                db.execute('INSERT OR REPLACE INTO plan VALUES (1, ?, ?)', (revision + 1, json.dumps(plan)))
            return self.reply(200, {'revision': revision + 1})
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {'error': 'Invalid race plan'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8091)
    args = parser.parse_args()
    DB.parent.mkdir(exist_ok=True)
    with sqlite3.connect(DB) as db:
        db.execute('CREATE TABLE IF NOT EXISTS plan (id INTEGER PRIMARY KEY, revision INTEGER, body TEXT)')
    print(f'Endurance Manager: http://localhost:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
