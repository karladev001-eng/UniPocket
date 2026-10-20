-- Server-owned identity: no anonymous session can claim or rename it.
ALTER TABLE profiles ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'user' CHECK(author_kind IN ('user','admin'));
CREATE UNIQUE INDEX one_admin_author ON profiles(author_kind) WHERE author_kind='admin';
INSERT INTO profiles(id,display_name,created_at,author_kind) VALUES('admin:'||lower(hex(randomblob(24))),'Uni Pocket運営',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'admin');
ALTER TABLE articles ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'user' CHECK(author_kind IN ('user','admin'));
CREATE TRIGGER protect_admin_profile BEFORE UPDATE ON profiles WHEN OLD.author_kind='admin' OR NEW.author_kind!=OLD.author_kind BEGIN SELECT RAISE(ABORT,'reserved_author'); END;
CREATE TRIGGER protect_admin_session BEFORE INSERT ON sessions WHEN EXISTS(SELECT 1 FROM profiles WHERE id=NEW.user_id AND author_kind='admin') BEGIN SELECT RAISE(ABORT,'reserved_author'); END;
CREATE TRIGGER protect_admin_session_update BEFORE UPDATE OF user_id ON sessions WHEN EXISTS(SELECT 1 FROM profiles WHERE id=NEW.user_id AND author_kind='admin') BEGIN SELECT RAISE(ABORT,'reserved_author'); END;
CREATE TRIGGER validate_article_author BEFORE INSERT ON articles WHEN NEW.author_kind!=(SELECT author_kind FROM profiles WHERE id=NEW.author_id) BEGIN SELECT RAISE(ABORT,'author_kind_mismatch'); END;
CREATE TRIGGER immutable_article_author BEFORE UPDATE OF author_id,author_kind ON articles WHEN NEW.author_id!=OLD.author_id OR NEW.author_kind!=OLD.author_kind BEGIN SELECT RAISE(ABORT,'immutable_author'); END;
