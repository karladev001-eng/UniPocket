import type { Database } from './types.ts';
import { ApiError } from './validation.ts';
import { cols, unpack, type Content } from './content.ts';
import { jstDay } from './shared.ts';
export function period(url: URL): {
    start: string;
    end: string;
} {
    const end = url.searchParams.get('end') || jstDay(), start = url.searchParams.get('start') || new Date(Date.parse(end) - 6 * 86400000).toISOString().slice(0, 10);
    for (const v of [start, end])
        if (!/^\d{4}-\d\d-\d\d$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)
            throw new ApiError(400, '期間が不正です。');
    const span = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (span < 0 || span >= 90 || end > jstDay())
        throw new ApiError(400, '期間は今日までの1–90日です。');
    return { start, end };
}
export async function metrics(db: Database, url: URL) {
    const { start, end } = period(url), asOf = new Date().toISOString();
    const settings = await db.prepare('SELECT collected_since FROM metric_settings WHERE id=1').first<{
        collected_since: string;
    }>();
    if (!settings)
        throw new Error('metrics settings missing');
    const retained = jstDay(Date.now() - 365 * 86400000);
    const collectedSince = settings.collected_since > retained ? settings.collected_since : retained;
    const records = await db.prepare('SELECT day,content_type,content_id,count FROM daily_content_metrics WHERE day>=? AND day<=?').bind(start, end).all<{
        day: string;
        content_type: string;
        content_id: string;
        count: number;
    }>();
    const daily = [];
    for (let n = Date.parse(start); n <= Date.parse(end); n += 86400000) {
        const day = new Date(n).toISOString().slice(0, 10), rows = records.results.filter(r => r.day === day);
        daily.push({ day, articleViews: day < collectedSince ? null : rows.filter(r => r.content_type === 'article').reduce((s, r) => s + r.count, 0), surveyResponses: day < collectedSince ? null : rows.filter(r => r.content_type === 'survey').reduce((s, r) => s + r.count, 0) });
    }
    const articles = await db.prepare(`SELECT a.id,a.title,COALESCE((SELECT SUM(count) FROM daily_content_metrics d WHERE d.content_type='article' AND d.content_id=a.id AND d.day>=? AND d.day<=?),0) AS views,CASE WHEN a.visibility='deleted' THEN 0 ELSE (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) END AS bookmarks FROM articles a ORDER BY a.created_at DESC`).bind(start, end).all<{
        id: string;
        title: string;
        views: number | null;
        bookmarks: number;
    }>();
    const incomplete = start < collectedSince;
    if (incomplete)
        for (const a of articles.results)
            a.views = null;
    return { start, end, collectedSince, asOf, daily, articleViews: incomplete ? null : daily.reduce((s, r) => s + (r.articleViews ?? 0), 0), currentBookmarks: articles.results.reduce((s, a) => s + a.bookmarks, 0), surveyResponses: incomplete ? null : daily.reduce((s, r) => s + (r.surveyResponses ?? 0), 0), articles: articles.results };
}
interface SurveyRetention {
    results_complete: number;
    results_since: string;
    response_count: number;
    created_at: string;
}
interface ResponseRow {
    answers: string;
    submitted_at: string;
}
interface ChoiceCount {
    question_id: string;
    option_id: string;
    count: number;
}
/** One D1 transaction prevents cleanup or new answers from splitting the count,
 * choice and completeness reads across two different retained-data windows. */
export async function surveyResultSnapshot(db: Database, id: string) {
    const [surveyRows, retentionRows, responses, counts] = await db.batch([
        db.prepare(`SELECT ${cols.surveys} FROM surveys WHERE id=?`).bind(id),
        db.prepare('SELECT results_complete,results_since,response_count,created_at FROM surveys WHERE id=?').bind(id),
        db.prepare("SELECT r.answers,r.submitted_at FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE r.survey_id=? AND (s.results_since='' OR r.submitted_at>=s.results_since) ORDER BY r.submitted_at,r.id").bind(id),
        db.prepare('SELECT question_id,option_id,count FROM survey_option_counts WHERE survey_id=?').bind(id),
    ]) as [
        {
            results: Content[];
        },
        {
            results: SurveyRetention[];
        },
        {
            results: ResponseRow[];
        },
        {
            results: ChoiceCount[];
        }
    ];
    const raw = surveyRows.results[0];
    if (!raw)
        throw new ApiError(404, '見つかりません。', 'not_found');
    const retention = retentionRows.results[0];
    if (!retention)
        throw new Error('survey results retention state missing');
    const survey = unpack(raw);
    const questions = survey.questions!.filter(q => q.type !== 'text').map(q => ({ questionId: q.id, counts: q.options.map(o => ({ optionId: o.id, count: counts.results.find(c => c.question_id === q.id && c.option_id === o.id)?.count ?? 0 })) }));
    const freeText: {
        questionId: string;
        value: string;
        submittedAt: string;
    }[] = [];
    for (const r of responses.results)
        for (const answer of JSON.parse(r.answers) as {
            questionId: string;
            value: string | string[];
        }[]) {
            const q = survey.questions!.find(q => q.id === answer.questionId);
            if (q?.type === 'text') {
                if (typeof answer.value === 'string' && answer.value)
                    freeText.push({ questionId: q.id, value: answer.value, submittedAt: r.submitted_at });
            }
        }
    return {
        responseRows: responses.results,
        result: {
            survey,
            responseCount: retention.response_count,
            resultsComplete: !!retention.results_complete,
            resultsSince: retention.results_since || retention.created_at,
            questions,
            freeText,
        },
    };
}
export async function surveyResults(db: Database, id: string) {
    return (await surveyResultSnapshot(db, id)).result;
}
