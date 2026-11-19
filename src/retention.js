// The nightly privacy clean-up (docs/ADMIN-PHASE-5.md §12, the Privacy page §5). Runs as the "privacy clean-up"
// part of the nightly job (src/index.js), after the usual clean-up of expired sign-ins and links.
//
//   IP addresses   removed from the activity log and from contact messages after 90 days (the entries stay)
//   email records  the email log keeps 1 year
//   known devices  a browser not used to sign in for 1 year is forgotten (the next sign-in from it is "new")
//   codes          used or expired 6-digit codes are deleted after a day
//
// Each step touches at most BATCH rows a night, so a backlog is worked off over a few nights without going near
// Workers Free's 100,000 rows written a day. Admin console sessions are removed after 30 days by
// src/console/index.js, and rate-limit counters after a day by src/index.js.
const DAY = 86400000;
const BATCH = 5000;
export const KEEP = { ipDays: 90, emailDays: 365, deviceDays: 365, codeDays: 1 };

export async function retention(env, now = Date.now()) {
  const before = (days) => new Date(now - days * DAY).toISOString();
  const DB = env.DB;
  const res = await DB.batch([
    DB.prepare(`UPDATE audit_logs SET ip = NULL WHERE rowid IN (SELECT rowid FROM audit_logs WHERE created_at < ?1 AND ip IS NOT NULL LIMIT ${BATCH})`).bind(before(KEEP.ipDays)),
    DB.prepare(`UPDATE contact_messages SET ip = NULL WHERE rowid IN (SELECT rowid FROM contact_messages WHERE created_at < ?1 AND ip IS NOT NULL LIMIT ${BATCH})`).bind(before(KEEP.ipDays)),
    DB.prepare(`DELETE FROM email_logs WHERE rowid IN (SELECT rowid FROM email_logs WHERE created_at < ?1 LIMIT ${BATCH})`).bind(before(KEEP.emailDays)),
    DB.prepare(`DELETE FROM known_devices WHERE rowid IN (SELECT rowid FROM known_devices WHERE last_seen < ?1 LIMIT ${BATCH})`).bind(before(KEEP.deviceDays)),
    DB.prepare(`DELETE FROM otp_verifications WHERE rowid IN (SELECT rowid FROM otp_verifications WHERE created_at < ?1 LIMIT ${BATCH})`).bind(before(KEEP.codeDays)),
  ]);
  const n = (i) => (res[i].meta && res[i].meta.changes) || 0;
  return { auditIps: n(0), contactIps: n(1), emails: n(2), devices: n(3), codes: n(4) };
}
