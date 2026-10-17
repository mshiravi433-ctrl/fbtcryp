/**
 * LOYALTY ECONOMY — the two point values that must NOT live in POINT_VALUES.
 * ---------------------------------------------------------------------------
 * `POINT_VALUES` is iterated by Leaderboard.jsx to build its "how to earn"
 * table. Adding `dailyWheel`/`learn` there would silently add two rows to a
 * page outside /rewards — and the brief for this change explicitly froze that
 * page. So the values live here, where only the hub reads them.
 *
 * They are NOT free-floating: `test/rewards-v2.test.jsx` imports the server's
 * ACTIONS table and asserts these numbers equal `server/rewards/config.js`.
 * The engine remains the authority; this file is the display mirror.
 */
export const WHEEL_POINT_VALUE = 25;
export const LEARN_POINT_VALUE = 50;
