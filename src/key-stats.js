// Typing statistics per key, read from both places they are kept (docs/INSTITUTES.md §6).
//  - user_state, key 'keyStats': the trainer's running totals { "a": { attempts, errors }, … }, saved whole by
//    PUT /api/user/progress/state. This is what the app sends after practice.
//  - key_stats: counts added by POST /api/user/stats, and copied once from user_state when an older account
//    moved to the events version (src/pipeline.js). The app doesn't call POST /api/user/stats, so for most
//    learners this table is empty: reading it alone left "weak keys" blank in the console and in Analytics.
// Both hold running totals of the same typing, never parts to add, so for each key the larger total wins.
// Reading the saved totals costs no extra writes: nothing new is stored.

const STATE_ROWS = (userCol, where) =>
  `SELECT ${userCol} AS user_id, j.key AS k, CAST(COALESCE(json_extract(j.value, '$.attempts'), 0) AS INTEGER) AS attempts,
          CAST(COALESCE(json_extract(j.value, '$.errors'), 0) AS INTEGER) AS errors
     FROM user_state s, json_each(s.value) j WHERE s.key = 'keyStats' AND ${where}`;

/**
 * Rows (k, attempts, errors) for one learner. user = the SQL placeholder holding the user id ('?1').
 * In SQLite a bare column next to MAX() comes from the row holding the maximum, so errors go with the
 * attempts they were counted with.
 */
export function keyStatsSql(user = '?1') {
  return `SELECT k, MAX(attempts) AS attempts, errors FROM (
            SELECT k, attempts, errors FROM key_stats WHERE user_id = ${user}
            UNION ALL
            SELECT k, attempts, errors FROM (${STATE_ROWS('s.user_id', `s.user_id = ${user}`)})
          ) GROUP BY k`;
}

/**
 * Rows (user_id, k, attempts, errors) for many learners. who(col) = an SQL condition on a user id column,
 * e.g. (col) => `${col} NOT IN (…)`; it is called once per source.
 */
export function keyStatsManySql(who) {
  return `SELECT user_id, k, MAX(attempts) AS attempts, errors FROM (
            SELECT user_id, k, attempts, errors FROM key_stats WHERE ${who('user_id')}
            UNION ALL
            ${STATE_ROWS('s.user_id', who('s.user_id'))}
          ) GROUP BY user_id, k`;
}
