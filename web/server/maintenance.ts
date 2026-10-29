import type { Database } from './types.ts';
import { jstDay } from './shared.ts';
/** Bounded, repeatable cleanup. Retains cumulative views and public author profiles. */
export async function cleanup(db: Database): Promise<void> {
    const now = Math.floor(Date.now() / 1000), stamp = new Date().toISOString();
    await db.prepare('UPDATE maintenance_status SET last_attempt=? WHERE id=1').bind(stamp).run();
    try {
        // Every accepted view/answer has already incremented its identifier-free daily
        // row in the same SQL statement. Deletion cannot race ahead of aggregation.
        await db.batch([
            db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 500)').bind(now),
            db.prepare('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE expires_at<=? LIMIT 500)').bind(now),
            db.prepare('DELETE FROM view_events WHERE rowid IN (SELECT rowid FROM view_events WHERE day_jst<? LIMIT 500)').bind(jstDay(Date.now() - 30 * 86400000)),
            // Erase low-entropy answer hashes together with their raw rows; only
            // the minimal one-response receipt survives reopening.
            db.prepare("UPDATE survey_response_receipts SET request_hash='' WHERE response_id IN (SELECT r.id FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.end_at<? OR (s.status='ended' AND s.ended_at<?) ORDER BY r.id LIMIT 500)").bind(new Date(Date.now() - 90 * 86400000).toISOString(), new Date(Date.now() - 90 * 86400000).toISOString()),
            db.prepare("DELETE FROM survey_responses WHERE id IN (SELECT r.id FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.end_at<? OR (s.status='ended' AND s.ended_at<?) ORDER BY r.id LIMIT 500)").bind(new Date(Date.now() - 90 * 86400000).toISOString(), new Date(Date.now() - 90 * 86400000).toISOString()),
            // Mark the result history before removing any choice aggregates.
            // The retained-window count must reset with the choices; otherwise
            // reopening would combine an old lifetime total with missing zeros.
            // Do not advance results_since repeatedly for an unchanged empty
            // expired survey, and never restore completeness on reopening.
            db.prepare(`UPDATE surveys SET results_complete=0,results_since=?,response_count=0
 WHERE (end_at<? OR (status='ended' AND ended_at<?))
 AND (results_complete=1 OR response_count>0 OR EXISTS(SELECT 1 FROM survey_option_counts c WHERE c.survey_id=surveys.id))`).bind(stamp, new Date(Date.now() - 365 * 86400000).toISOString(), new Date(Date.now() - 365 * 86400000).toISOString()),
            db.prepare('DELETE FROM daily_content_metrics WHERE day<?').bind(jstDay(Date.now() - 365 * 86400000)),
            db.prepare("DELETE FROM survey_option_counts WHERE survey_id IN (SELECT id FROM surveys WHERE end_at<? OR (status='ended' AND ended_at<?))").bind(new Date(Date.now() - 365 * 86400000).toISOString(), new Date(Date.now() - 365 * 86400000).toISOString()),
            db.prepare('DELETE FROM admin_audit WHERE created_at<?').bind(new Date(Date.now() - 365 * 86400000).toISOString()),
            db.prepare('DELETE FROM create_keys WHERE rowid IN (SELECT rowid FROM create_keys WHERE created_at<? LIMIT 500)').bind(now - 30 * 86400),
            db.prepare(`UPDATE maintenance_status SET last_success=?,failures=0,
 pending_views=(SELECT COUNT(*) FROM view_events WHERE day_jst<?),
 pending_responses=(SELECT COUNT(*) FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.end_at<? OR (s.status='ended' AND s.ended_at<?)) WHERE id=1`).bind(stamp, jstDay(Date.now() - 30 * 86400000), new Date(Date.now() - 90 * 86400000).toISOString(), new Date(Date.now() - 90 * 86400000).toISOString()),
        ]);
        const pending = await db.prepare('SELECT pending_views,pending_responses FROM maintenance_status WHERE id=1').first<{
            pending_views: number;
            pending_responses: number;
        }>();
        if (pending && (pending.pending_views || pending.pending_responses))
            console.warn('Content retention has expired records pending; next scheduled run retries');
    }
    catch (error) {
        console.error('Content retention cleanup failed; next scheduled run retries');
        await db.prepare('UPDATE maintenance_status SET last_failure=?,failures=failures+1 WHERE id=1').bind(stamp).run();
        throw error;
    }
}
