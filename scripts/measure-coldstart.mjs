/*
 * THE COLD-START MEASUREMENT.
 *
 * The number that matters on Vercel Hobby: the Fluid Active CPU allowance
 * is 4 hours per rolling 30 days — about eight minutes of CPU per day —
 * and a cold start is charged against it BEFORE the first byte of the first
 * request is served.
 *
 * So the measurement is CPU, not wall time: wall time includes the disk and
 * the scheduler, and only CPU is billed.
 *
 * Run it three times. The first run after a change is often a disk-cache
 * fluke (one run in this session measured 2,802 ms against a 588 ms
 * baseline), and a single number is not a measurement.
 */
process.env.SKIP_CRON_BOOT = '1';

const t0 = process.hrtime.bigint();
try {
  await import('/home/user/fbtcryp/server/app.js');
} catch (e) {
  console.log('IMPORT ERROR:', e.message.split('\n')[0]);
}
const t1 = process.hrtime.bigint();
const wallMs = Number(t1 - t0) / 1e6;
const cpu = process.cpuUsage();
const m = process.memoryUsage();
console.log(JSON.stringify({
  wallMs: Math.round(wallMs),
  cpuTotalMs: Math.round((cpu.user + cpu.system) / 1000),
  heapMB: Math.round(m.heapUsed / 1048576),
  rssMB: Math.round(m.rss / 1048576)
}, null, 2));
