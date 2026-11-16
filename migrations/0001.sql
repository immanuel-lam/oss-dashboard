CREATE TABLE IF NOT EXISTS metrics (
 source TEXT NOT NULL, date TEXT NOT NULL, metric TEXT NOT NULL,
 value REAL NOT NULL CHECK(value >= 0), unit TEXT NOT NULL,
 timezone TEXT NOT NULL, provenance TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(source,date,metric)
);
CREATE TABLE IF NOT EXISTS sync_runs (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at TEXT NOT NULL,
 finished_at TEXT, status TEXT NOT NULL, message TEXT
);
