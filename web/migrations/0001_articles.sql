PRAGMA foreign_keys = ON;
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES profiles(id),
  public_url TEXT NOT NULL,
  embed_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 280),
  category TEXT NOT NULL DEFAULT '',
  course_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK(view_count >= 0),
  UNIQUE(author_id, public_url)
);
CREATE INDEX articles_created ON articles(created_at DESC, id DESC);
CREATE INDEX articles_author ON articles(author_id, created_at DESC, id DESC);
CREATE INDEX articles_category ON articles(category, created_at DESC, id DESC);
CREATE INDEX articles_course ON articles(course_id, created_at DESC, id DESC);
CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES profiles(id),
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, article_id)
);
CREATE INDEX bookmarks_article ON bookmarks(article_id);
CREATE TABLE view_events (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL REFERENCES profiles(id),
  day_jst TEXT NOT NULL,
  PRIMARY KEY(article_id, viewer_key, day_jst)
);
CREATE INDEX view_events_day ON view_events(day_jst);
CREATE TRIGGER count_new_view AFTER INSERT ON view_events BEGIN
  UPDATE articles SET view_count = view_count + 1 WHERE id = NEW.article_id;
END;
-- Keep keys after article deletion so an uncertain create retry cannot resurrect it.
CREATE TABLE create_keys (
  user_id TEXT NOT NULL REFERENCES profiles(id),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  article_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, request_key)
);
CREATE INDEX create_keys_created ON create_keys(created_at);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
