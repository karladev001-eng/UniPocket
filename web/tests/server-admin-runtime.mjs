import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, day, instant, owner } from './helpers/server-admin-fixture.mjs';
test('real D1/Access: every admin URL requires signed owner JWT and complete configuration', async () => {
    const r = await runtime();
    try {
        for (const path of ['/', '/assets/admin.js', '/sw.js', '/api/admin/me', '/api/admin/metrics.csv']) {
            assert.equal((await r.send(path, 'GET', undefined, undefined, { 'Cf-Access-Jwt-Assertion': '' }, 'admin')).status, 401, path);
            assert.equal((await r.send(path, 'GET', undefined, undefined, {}, 'unconfigured')).status, 503, path);
        }
        const invalid = [{ aud: ['wrong'] }, { iss: 'https://attacker.cloudflareaccess.com' }, { exp: Math.floor(Date.now() / 1000) - 1 }, { email: 'reader@example.test' }, { email: null }, { nbf: Math.floor(Date.now() / 1000) + 3600 }];
        for (const claims of invalid)
            assert.equal((await r.adm('/me', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await r.token(claims) })).status, 401, JSON.stringify(claims));
        const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
        assert.equal((await r.adm('/me', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await r.token({}, other.privateKey) })).status, 401);
        const good = await r.adm('/me');
        assert.equal(good.status, 200);
        assert.equal(good.data.admin.email, owner);
        assert.equal((await r.send('/', 'GET', undefined, undefined, {}, 'admin')).headers.get('Cache-Control'), 'private, no-store');
        assert.equal((await r.send('/sw.js', 'GET', undefined, undefined, {}, 'admin')).status, 404);
        assert.equal((await r.send('/api/admin/me')).status, 404);
        assert.equal((await r.adm('/announcements', 'POST', {}, { Origin: 'https://attacker.test' })).status, 403);
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 moderation: all public paths, author rights, reports, CAS and audit rollback', async () => {
    const r = await runtime();
    try {
        const a = await r.session(), b = await r.session(), article = await r.article(a.cookie), id = article.id;
        await r.send(`/api/articles/${id}/bookmark`, 'PUT', {}, b.cookie);
        await r.send(`/api/articles/${id}/view`, 'POST', {}, b.cookie);
        for (let n = 0; n < 3; n++)
            assert.equal((await r.send(`/api/articles/${id}/report`, 'POST', { reason: 'incorrect', details: '補足' }, b.cookie)).status, 200);
        let reports = await r.adm('/reports?status=pending');
        assert.equal(reports.data.reports.length, 1);
        assert.ok(!JSON.stringify(reports.data).includes(b.id));
        const report = reports.data.reports[0];
        assert.equal((await r.adm('/reports/' + report.id, 'PATCH', { revision: 1, status: 'reviewed' })).status, 200);
        assert.equal((await r.adm('/reports/' + report.id, 'PATCH', { revision: 1, status: 'pending' })).status, 409);
        // A real SQL trigger failure at audit insertion must roll the article update back.
        await r.db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
        assert.equal((await r.adm(`/articles/${id}/visibility`, 'POST', { revision: 1, visibility: 'hidden', reason: '確認中' }, { 'Idempotency-Key': crypto.randomUUID() })).status, 503);
        assert.equal((await r.send('/api/articles/' + id)).data.article.revision, 1);
        await r.db.exec('DROP TRIGGER reject_audit');
        const hideBody = { revision: 1, visibility: 'hidden', reason: '確認中' }, hideKey = crypto.randomUUID();
        const hidden = await Promise.all(Array.from({ length: 8 }, () => r.adm(`/articles/${id}/visibility`, 'POST', hideBody, { 'Idempotency-Key': hideKey })));
        for (const h of hidden) {
            assert.equal(h.status, 200, JSON.stringify(h.data));
            assert.equal(h.data.article.revision, 2);
        }
        assert.equal((await r.db.prepare("SELECT COUNT(*) n FROM admin_audit WHERE target_id=? AND action='article.hidden'").bind(id).first()).n, 1);
        for (const query of ['', '?sort=popular', '?q=SUM', '?authorId=' + a.id, '?category=学習', '?bookmarked=1'])
            assert.deepEqual((await r.send('/api/articles' + query, 'GET', undefined, b.cookie)).data.articles, [], query);
        for (const [action, method, body] of [['', 'GET', undefined], ['/view', 'POST', {}], ['/bookmark', 'PUT', {}], ['/bookmark', 'DELETE', undefined], ['/report', 'POST', { reason: 'other', details: '' }]])
            assert.equal((await r.send('/api/articles/' + id + action, method, body, b.cookie)).status, 404);
        await assert.rejects(r.db.prepare('INSERT INTO view_events VALUES(?,?,?)').bind(id, a.id, day(0)).run(), /article_not_public/);
        await assert.rejects(r.db.prepare('INSERT INTO bookmarks VALUES(?,?)').bind(a.id, id).run(), /article_not_public/);
        const mine = (await r.send('/api/my/articles', 'GET', undefined, a.cookie)).data.articles[0];
        assert.equal(mine.visibility, 'hidden');
        assert.equal(mine.hiddenReason, '確認中');
        assert.equal((await r.send('/api/articles/' + id, 'PATCH', { title: '作者修正' }, a.cookie, { 'If-Match': '1' })).status, 409);
        const edit = await r.send('/api/articles/' + id, 'PATCH', { title: '作者修正' }, a.cookie, { 'If-Match': '2' });
        assert.equal(edit.status, 200);
        assert.equal(edit.data.article.visibility, 'hidden');
        assert.equal(edit.data.article.revision, 3);
        const races = await Promise.all([
            r.send('/api/articles/' + id, 'PATCH', { title: '作者の競合' }, a.cookie, { 'If-Match': '3' }),
            r.adm(`/articles/${id}/visibility`, 'POST', { revision: 3, visibility: 'published', reason: '' }, { 'Idempotency-Key': crypto.randomUUID() })
        ]);
        assert.deepEqual(races.map(x => x.status).sort(), [200, 409]);
        const current = (await r.adm('/articles')).data.articles.find(x => x.id === id);
        assert.equal((await r.send('/api/articles/' + id, 'DELETE', undefined, a.cookie, { 'If-Match': String(current.revision) })).status, 200);
        const deleted = (await r.adm('/articles?visibility=deleted')).data.articles[0];
        assert.equal(deleted.visibility, 'deleted');
        assert.equal(deleted.summary, '');
        assert.equal(deleted.bookmarkCount, 0);
        const currentMetrics = await r.adm('/metrics?start=' + day(0) + '&end=' + day(0));
        assert.equal(currentMetrics.data.currentBookmarks, 0);
        assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM bookmarks WHERE article_id=?').bind(id).first()).n, 1);
        assert.equal((await r.adm(`/articles/${id}/visibility`, 'POST', { revision: deleted.revision, visibility: 'published', reason: '' }, { 'Idempotency-Key': crypto.randomUUID() })).status, 409);
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 announcements: draft, timing, revised read identity, conflict, end and reopen', async () => {
    const r = await runtime();
    try {
        const c = await r.content('announcements');
        assert.equal((await r.send('/api/announcements')).data.announcements.length, 0);
        const publication = await r.publish('announcements', c);
        assert.equal(publication.status, 200, JSON.stringify(publication.data));
        let current = publication.data.announcement;
        assert.equal((await r.send('/api/announcements/' + c.id)).data.announcement.revision, 2);
        const edited = await r.adm('/announcements/' + c.id, 'PATCH', { revision: 2, body: '改訂本文' });
        assert.equal(edited.status, 200);
        assert.equal(edited.data.announcement.revision, 3);
        assert.equal((await r.adm('/announcements/' + c.id, 'PATCH', { revision: 2, title: '競合' })).status, 409);
        assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM announcement_revisions WHERE announcement_id=?').bind(c.id).first()).n, 3);
        current = edited.data.announcement;
        const ended = await r.adm('/announcements/' + c.id + '/end', 'POST', { revision: 3 }, { 'Idempotency-Key': crypto.randomUUID() });
        assert.equal(ended.status, 200);
        assert.equal((await r.send('/api/announcements/' + c.id)).status, 404);
        assert.equal((await r.publish('announcements', ended.data.announcement)).status, 200);
        const scheduled = await r.content('announcements', { startAt: instant(1), endAt: instant(2) });
        await r.publish('announcements', scheduled);
        assert.equal((await r.send('/api/announcements/' + scheduled.id)).status, 404);
        await r.db.prepare('UPDATE announcements SET end_at=? WHERE id=?').bind(instant(-0.1), c.id).run();
        assert.equal((await r.send('/api/announcements/' + c.id)).status, 404);
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 surveys: immutable publication, answers, concurrent retries, deadline, CSV and metrics', async () => {
    const r = await runtime();
    try {
        const user = await r.session(), article = await r.article(user.cookie);
        await r.send(`/api/articles/${article.id}/bookmark`, 'PUT', {}, user.cookie);
        await r.send(`/api/articles/${article.id}/view`, 'POST', {}, user.cookie);
        const draft = await r.content('surveys'), survey = (await r.publish('surveys', draft)).data.survey;
        assert.equal((await r.adm('/surveys/' + survey.id, 'PATCH', { revision: survey.revision, questions: survey.questions.map(q => ({ ...q, title: '変更' })) })).status, 409);
        assert.equal((await r.adm('/surveys/' + survey.id, 'PATCH', { revision: survey.revision, title: '改題' })).status, 200);
        assert.equal((await r.send('/api/surveys/' + survey.id, 'GET', undefined, user.cookie)).data.answered, false);
        const answers = { answers: [{ questionId: survey.questions[0].id, value: survey.questions[0].options[0].id }, { questionId: survey.questions[1].id, value: '=IMPORTXML("https://bad.test")' }] }, key = crypto.randomUUID();
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', { answers: [] }, user.cookie, { 'Idempotency-Key': crypto.randomUUID() })).status, 400);
        const responses = await Promise.all(Array.from({ length: 8 }, () => r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, user.cookie, { 'Idempotency-Key': key })));
        for (const row of responses) {
            assert.equal(row.status, 200, JSON.stringify(row.data));
            assert.equal(row.data.responseId, responses[0].data.responseId);
        }
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, user.cookie, { 'Idempotency-Key': crypto.randomUUID() })).data.responseId, responses[0].data.responseId);
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', { answers: [] }, user.cookie, { 'Idempotency-Key': key })).status, 409);
        assert.equal((await r.send('/api/surveys', 'GET', undefined, user.cookie)).data.surveys[0].answered, true);
        const results = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(results.data.responseCount, 1);
        assert.equal(results.data.questions[0].counts[0].count, 1);
        assert.equal(results.data.freeText.length, 1);
        assert.equal((await r.send('/api/surveys/' + survey.id + '/results')).status, 404);
        const exported = await r.adm('/surveys/' + survey.id + '/responses.csv');
        assert.equal(exported.status, 200);
        assert.match(exported.data, /'=IMPORTXML/);
        assert.ok(!exported.data.includes(user.id));
        assert.ok(!exported.data.includes(responses[0].data.responseId));
        const today = await r.adm('/metrics?start=' + day(0) + '&end=' + day(0));
        assert.equal(today.data.articleViews, 1);
        assert.equal(today.data.surveyResponses, 1);
        assert.equal(today.data.currentBookmarks, 1);
        const week = await r.adm('/metrics?start=' + day(-6) + '&end=' + day(0));
        assert.equal(week.data.daily[0].articleViews, null);
        assert.equal(week.data.articleViews, null);
        assert.equal(week.data.currentBookmarks, 1);
        assert.equal((await r.adm('/metrics?start=' + day(-90) + '&end=' + day(0))).status, 400);
        const csv = await r.adm('/metrics.csv?start=' + day(0) + '&end=' + day(0));
        assert.match(csv.data, /'=SUM/);
        assert.ok(!csv.data.includes(user.id));
        assert.match(csv.data, /currentBookmarks/);
        await r.db.prepare('UPDATE surveys SET end_at=? WHERE id=?').bind(instant(-0.1), survey.id).run();
        const late = await r.session();
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, late.cookie, { 'Idempotency-Key': crypto.randomUUID() })).status, 410);
        assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM survey_responses').first()).n, 1);
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 retention: daily/choice totals survive raw deletion, retry is safe and failures are visible', async () => {
    const r = await runtime();
    try {
        const user = await r.session(), article = await r.article(user.cookie), draft = await r.content('surveys'), survey = (await r.publish('surveys', draft)).data.survey;
        const answers = { answers: [{ questionId: survey.questions[0].id, value: survey.questions[0].options[0].id }] }, key = crypto.randomUUID();
        await r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, user.cookie, { 'Idempotency-Key': key });
        await r.db.prepare('INSERT INTO view_events VALUES(?,?,?)').bind(article.id, user.id, day(-31)).run();
        await r.db.prepare("UPDATE surveys SET status='ended',ended_at=? WHERE id=?").bind(instant(-91), survey.id).run();
        await r.cleanup();
        await r.cleanup();
        assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM view_events').first()).n, 0);
        assert.equal((await r.db.prepare('SELECT count FROM daily_content_metrics WHERE content_id=?').bind(article.id).first()).count, 1);
        assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM survey_responses').first()).n, 0);
        const receipts = await r.db.prepare('SELECT * FROM survey_response_receipts').all();
        assert.equal(receipts.results[0].request_hash, '');
        assert.ok(!JSON.stringify(receipts.results).includes(user.id));
        assert.ok(!JSON.stringify(receipts.results).includes(key));
        const results = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(results.data.responseCount, 1);
        assert.equal(results.data.questions[0].counts[0].count, 1);
        assert.deepEqual(results.data.freeText, []);
        await r.db.prepare("UPDATE surveys SET status='published',end_at=?,ended_at=NULL WHERE id=?").bind(instant(1), survey.id).run();
        const replay = await r.send('/api/surveys/' + survey.id + '/responses', 'POST', { answers: [] }, user.cookie, { 'Idempotency-Key': key });
        assert.equal(replay.status, 200);
        assert.equal((await r.db.prepare('SELECT COUNT(*) n FROM survey_responses').first()).n, 0);
        await r.db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON daily_content_metrics BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
        await r.db.prepare("INSERT INTO daily_content_metrics VALUES(?,'article',?,1,?)").bind(day(-366), article.id, instant(-366)).run();
        assert.equal((await r.cleanup()).status, 500);
        const failed = await r.db.prepare('SELECT failures,last_failure FROM maintenance_status').first();
        assert.equal(failed.failures, 1);
        assert.ok(failed.last_failure);
        await r.db.exec('DROP TRIGGER fail_cleanup');
        assert.equal((await r.cleanup()).status, 200);
        assert.equal((await r.db.prepare('SELECT failures FROM maintenance_status').first()).failures, 0);
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 shared school IP permits 100 initial sessions and rejects unbounded spam', async () => {
    const r = await runtime();
    try {
        const first = await Promise.all(Array.from({ length: 100 }, () => r.send('/api/session', 'POST', {})));
        for (const row of first)
            assert.equal(row.status, 200, JSON.stringify(row.data));
        assert.equal(new Set(first.map(x => x.data.user.id)).size, 100);
        const spam = await Promise.all(Array.from({ length: 100 }, () => r.send('/api/session', 'POST', {})));
        assert.ok(spam.some(x => x.status === 429));
        const questions = Array.from({ length: 10 }, () => ({ id: crypto.randomUUID(), title: '問'.repeat(200), type: 'multiple', required: false, options: Array.from({ length: 10 }, () => ({ id: crypto.randomUUID(), label: '選'.repeat(200) })) }));
        const full = await r.content('surveys', { questions, intro: '紹'.repeat(2000) });
        assert.equal(full.questions.length, 10);
        const textQuestions = Array.from({ length: 10 }, () => ({ id: crypto.randomUUID(), title: '任意', type: 'text', required: false, options: [] }));
        const draft = await r.content('surveys', { questions: textQuestions }), survey = (await r.publish('surveys', draft)).data.survey;
        // Separate IP avoids the intentional burst limit just exercised above.
        const response = await r.send('/api/surveys/' + survey.id + '/responses', 'POST', { answers: textQuestions.map(q => ({ questionId: q.id, value: '文'.repeat(1000) })) }, first[0].headers.get('Set-Cookie').split(';')[0], { 'Idempotency-Key': crypto.randomUUID(), 'CF-Connecting-IP': '192.0.2.2' });
        assert.equal(response.status, 200, JSON.stringify(response.data));
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 admin paging: more than 500 articles/reports remain searchable and individually reachable', async () => {
    const r = await runtime();
    try {
        const user = await r.session();
        const ids = Array.from({ length: 505 }, () => crypto.randomUUID());
        for (let start = 0; start < ids.length; start += 50) {
            const chunk = ids.slice(start, start + 50);
            await r.db.batch(chunk.flatMap((id, n) => [
                r.db.prepare("INSERT INTO articles(id,author_id,public_url,title,category,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, user.id, 'https://demo.notion.site/' + id, start === 0 && n === 0 ? '昔の記事' : '記事' + (start + n), '学習', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
                r.db.prepare("INSERT INTO article_reports(id,article_id,user_id,reason,details,created_at,updated_at) VALUES(?,?,?,'other','','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')").bind(crypto.randomUUID(), id, user.id)
            ]));
        }
        for (const type of ['articles', 'reports']) {
            const all = [];
            let cursor = null;
            do {
                const result = await r.adm('/' + type + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                assert.equal(result.status, 200, JSON.stringify(result.data));
                all.push(...result.data[type].map(x => x.id));
                cursor = result.data.nextCursor;
            } while (cursor);
            assert.equal(all.length, 505);
            assert.equal(new Set(all).size, 505);
            assert.equal((await r.adm('/' + type + '?cursor=garbage')).status, 400);
            assert.equal((await r.adm('/' + type + '?limit=101')).status, 400);
        }
        const found = await r.adm('/articles?q=' + encodeURIComponent('昔の記事'));
        assert.equal(found.data.articles.length, 1);
        assert.equal(found.data.articles[0].id, ids[0]);
        assert.equal((await r.adm('/articles/' + ids[0])).data.article.id, ids[0]);
        const byAuthor = await r.adm('/articles?q=' + encodeURIComponent('匿名ユーザー') + '&visibility=published');
        assert.equal(byAuthor.data.articles.length, 50);
        assert.ok(byAuthor.data.nextCursor);
    }
    finally {
        await r.mf.dispose();
    }
});
test('real D1 expired survey history remains incomplete after reopening, with consistent retained-window totals', async () => {
    const r = await runtime();
    try {
        const first = await r.session();
        const draft = await r.content('surveys');
        let survey = (await r.publish('surveys', draft)).data.survey;
        const question = survey.questions[0], option = question.options[0];
        const answers = { answers: [{ questionId: question.id, value: option.id }] };
        let result = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(result.data.resultsComplete, true);
        assert.equal(result.data.resultsSince, survey.createdAt);
        assert.equal(result.data.responseCount, 0);
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, first.cookie, { 'Idempotency-Key': crypto.randomUUID() })).status, 200);
        result = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(result.data.responseCount, 1);
        assert.equal(result.data.questions[0].counts[0].count, 1);
        await r.db.prepare("UPDATE surveys SET status='ended',ended_at=?,end_at=? WHERE id=?").bind(instant(-366), instant(-366), survey.id).run();
        await r.db.exec("CREATE TRIGGER fail_choice_expiry BEFORE DELETE ON survey_option_counts BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
        assert.equal((await r.cleanup()).status,500);
        const rolledBack=await r.db.prepare('SELECT results_complete,response_count FROM surveys WHERE id=?').bind(survey.id).first();
        assert.equal(rolledBack.results_complete,1);
        assert.equal(rolledBack.response_count,1);
        assert.equal((await r.db.prepare('SELECT count FROM survey_option_counts WHERE survey_id=?').bind(survey.id).first()).count,1);
        await r.db.exec('DROP TRIGGER fail_choice_expiry');
        assert.equal((await r.cleanup()).status, 200);
        result = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(result.status, 200);
        assert.equal(result.data.resultsComplete, false);
        assert.equal(result.data.responseCount, 0);
        assert.equal(result.data.questions[0].counts[0].count, 0);
        const retainedSince = result.data.resultsSince;
        assert.ok(Number.isFinite(Date.parse(retainedSince)));
        assert.ok(Date.parse(retainedSince) >= Date.parse(survey.createdAt));
        assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM survey_option_counts WHERE survey_id=?').bind(survey.id).first()).n, 0);
        assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM survey_responses WHERE survey_id=?').bind(survey.id).first()).n, 0);
        assert.equal((await r.cleanup()).status, 200);
        assert.equal((await r.adm('/surveys/' + survey.id + '/results')).data.resultsSince, retainedSince);
        const updated = await r.adm('/surveys/' + survey.id, 'PATCH', { revision: survey.revision, endAt: instant(1) });
        assert.equal(updated.status, 200, JSON.stringify(updated.data));
        const reopened = await r.publish('surveys', updated.data.survey);
        assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
        result = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(result.data.resultsComplete, false);
        assert.equal(result.data.resultsSince, retainedSince);
        assert.equal(result.data.responseCount, 0);
        assert.equal(result.data.questions[0].counts[0].count, 0);
        const second = await r.session();
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, second.cookie, { 'Idempotency-Key': crypto.randomUUID() })).status, 200);
        result = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(result.data.resultsComplete, false);
        assert.equal(result.data.resultsSince, retainedSince);
        assert.equal(result.data.responseCount, 1);
        assert.equal(result.data.questions[0].counts[0].count, 1);
        assert.equal((await r.db.prepare('SELECT response_count FROM surveys WHERE id=?').bind(survey.id).first()).response_count, 1);
        const exported = await r.adm('/surveys/' + survey.id + '/responses.csv');
        assert.equal(exported.status, 200);
        assert.match(exported.data, /"resultsComplete","false"/);
        assert.ok(exported.data.includes(retainedSince));
        assert.ok(!exported.data.includes(first.id));
        // A retained receipt still blocks the first anonymous identity, but is
        // never counted as an answer in the retained analytics window.
        assert.equal((await r.send('/api/surveys/' + survey.id + '/responses', 'POST', answers, first.cookie, { 'Idempotency-Key': crypto.randomUUID() })).status, 200);
        result = await r.adm('/surveys/' + survey.id + '/results');
        assert.equal(result.data.responseCount, 1);
        assert.equal(result.data.questions[0].counts[0].count, 1);
    }
    finally {
        await r.mf.dispose();
    }
});
