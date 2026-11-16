-- Manual grouping of the same video across platforms. Auto-grouping happens in the UI; rows here override it.
-- group_id 'solo:<source>:<content_id>' keeps an item on its own.
CREATE TABLE IF NOT EXISTS content_groups(source TEXT NOT NULL, content_id TEXT NOT NULL, group_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source,content_id));
