CREATE TABLE connections(provider TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE oauth_states(state TEXT PRIMARY KEY, provider TEXT NOT NULL, identity TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE sync_locks(source TEXT PRIMARY KEY, expires INTEGER NOT NULL);
