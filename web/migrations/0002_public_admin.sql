-- Additive: existing anonymous identities, author rights, article IDs and counts survive.
ALTER TABLE articles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'published' CHECK(visibility IN ('published','hidden','deleted'));
ALTER TABLE articles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE articles ADD COLUMN hidden_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX articles_visibility ON articles(visibility,created_at DESC,id DESC);
CREATE TABLE article_reports(id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id),user_id TEXT NOT NULL REFERENCES profiles(id),reason TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed')),revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX report_pending ON article_reports(article_id,user_id) WHERE status='pending';
CREATE TABLE announcements(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,link TEXT NOT NULL DEFAULT '',start_at TEXT NOT NULL,end_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','ended')),revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE announcement_revisions(announcement_id TEXT NOT NULL REFERENCES announcements(id),revision INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,link TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(announcement_id,revision));
CREATE TABLE surveys(id TEXT PRIMARY KEY,title TEXT NOT NULL,intro TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','ended')),revision INTEGER NOT NULL DEFAULT 1,questions TEXT NOT NULL,ever_published INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE survey_responses(id TEXT PRIMARY KEY,survey_id TEXT NOT NULL REFERENCES surveys(id),user_id TEXT NOT NULL REFERENCES profiles(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,answers TEXT NOT NULL,submitted_at TEXT NOT NULL,day_jst TEXT NOT NULL,UNIQUE(survey_id,user_id),UNIQUE(survey_id,user_id,request_key));
CREATE TABLE admin_audit(id TEXT PRIMARY KEY,admin_email TEXT NOT NULL,target_id TEXT NOT NULL,action TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE admin_keys(request_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,operation_id TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE metric_settings(id INTEGER PRIMARY KEY CHECK(id=1),collected_since TEXT NOT NULL);
INSERT INTO metric_settings VALUES(1,strftime('%Y-%m-%d','now','+9 hours'));
CREATE TABLE daily_content_metrics(day TEXT NOT NULL,content_type TEXT NOT NULL CHECK(content_type IN ('article','survey')),content_id TEXT NOT NULL,count INTEGER NOT NULL CHECK(count>=0),finalized_at TEXT NOT NULL,PRIMARY KEY(day,content_type,content_id));
INSERT INTO daily_content_metrics SELECT day_jst,'article',article_id,COUNT(*),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM view_events WHERE day_jst >= (SELECT collected_since FROM metric_settings WHERE id=1) GROUP BY day_jst,article_id;
CREATE TRIGGER aggregate_new_view AFTER INSERT ON view_events BEGIN
 INSERT INTO daily_content_metrics VALUES(NEW.day_jst,'article',NEW.article_id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(day,content_type,content_id) DO UPDATE SET count=count+1,finalized_at=excluded.finalized_at;
END;
CREATE TRIGGER aggregate_new_response AFTER INSERT ON survey_responses BEGIN
 INSERT INTO daily_content_metrics VALUES(NEW.day_jst,'survey',NEW.survey_id,1,NEW.submitted_at) ON CONFLICT(day,content_type,content_id) DO UPDATE SET count=count+1,finalized_at=excluded.finalized_at;
END;
-- SQL guards close the gap between a public route's read and its later write.
CREATE TRIGGER public_view_guard BEFORE INSERT ON view_events WHEN NOT EXISTS(SELECT 1 FROM articles WHERE id=NEW.article_id AND visibility='published') BEGIN SELECT RAISE(ABORT,'article_not_public'); END;
CREATE TRIGGER public_bookmark_guard BEFORE INSERT ON bookmarks WHEN NOT EXISTS(SELECT 1 FROM articles WHERE id=NEW.article_id AND visibility='published') BEGIN SELECT RAISE(ABORT,'article_not_public'); END;
CREATE TRIGGER public_bookmark_delete_guard BEFORE DELETE ON bookmarks WHEN EXISTS(SELECT 1 FROM articles WHERE id=OLD.article_id AND visibility!='published') BEGIN SELECT RAISE(ABORT,'article_not_public'); END;
CREATE TABLE maintenance_status(id INTEGER PRIMARY KEY CHECK(id=1),last_attempt TEXT,last_success TEXT,last_failure TEXT,failures INTEGER NOT NULL DEFAULT 0);
INSERT INTO maintenance_status(id) VALUES(1);
-- Choice results contain only content IDs and counts and survive raw-answer expiry.
CREATE TABLE survey_option_counts(survey_id TEXT NOT NULL,question_id TEXT NOT NULL,option_id TEXT NOT NULL,count INTEGER NOT NULL,finalized_at TEXT NOT NULL,PRIMARY KEY(survey_id,question_id,option_id));
CREATE TRIGGER aggregate_response_choices AFTER INSERT ON survey_responses BEGIN
 INSERT INTO survey_option_counts(survey_id,question_id,option_id,count,finalized_at)
 SELECT NEW.survey_id,json_extract(a.value,'$.questionId'),o.value,1,NEW.submitted_at
 FROM json_each(NEW.answers) a, json_each(CASE json_type(a.value,'$.value') WHEN 'array' THEN json_extract(a.value,'$.value') ELSE json_array(json_extract(a.value,'$.value')) END) o
 WHERE EXISTS(SELECT 1 FROM surveys s,json_each(s.questions) q WHERE s.id=NEW.survey_id AND json_extract(q.value,'$.id')=json_extract(a.value,'$.questionId') AND json_extract(q.value,'$.type') IN ('single','multiple'))
 ON CONFLICT(survey_id,question_id,option_id) DO UPDATE SET count=count+1,finalized_at=excluded.finalized_at;
END;
-- Minimal, irreversible receipts allow retry/dedup after the raw answers expire.
-- Hashes are domain separated by survey ID, so equal anonymous IDs or answers
-- do not have equal hashes across surveys. Receipts last for the survey lifetime
-- to preserve one-response semantics on reopening. They retain no answers,
-- original anonymous ID, IP, timestamp, or user-supplied request key. request_hash
-- is transient and erased in the same retention batch as the raw answer row.
CREATE TABLE survey_response_receipts(survey_id TEXT NOT NULL REFERENCES surveys(id),user_hash TEXT NOT NULL,key_hash TEXT NOT NULL,request_hash TEXT NOT NULL,response_id TEXT NOT NULL,PRIMARY KEY(survey_id,user_hash),UNIQUE(user_hash,key_hash));

ALTER TABLE surveys ADD COLUMN ended_at TEXT;

CREATE INDEX survey_receipt_hash ON survey_response_receipts(user_hash);
ALTER TABLE maintenance_status ADD COLUMN pending_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_status ADD COLUMN pending_responses INTEGER NOT NULL DEFAULT 0;
-- A content-level lifetime total, analogous to articles.view_count, is separate
-- from the rolling 365-day daily series and contains no respondent identity.
ALTER TABLE surveys ADD COLUMN response_count INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER count_new_response AFTER INSERT ON survey_responses BEGIN
 UPDATE surveys SET response_count=response_count+1 WHERE id=NEW.survey_id;
END;
