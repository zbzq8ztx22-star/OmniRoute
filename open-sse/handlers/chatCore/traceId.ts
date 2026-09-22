/**
 * Trace id for one chat attempt.
 *
 * This value has two jobs, and the second one is the reason it lives in its own
 * module with a test (#14338):
 *
 * 1. It correlates `[STAGE_TRACE]` log lines for a single attempt, so a hung
 *    request can be traced to the exact await it was sitting on.
 * 2. `persistAttemptLogs` writes it to `call_logs.id`, which is
 *    `id TEXT PRIMARY KEY`, and it is the id carried by the paired
 *    `request.started` / `request.completed` dashboard events (#13481). Each
 *    combo target re-enters `handleChatCore`, so one id is minted per attempt.
 *
 * Because of (2) the id needs uniqueness across every row the table still
 * holds, not just across in-flight requests. The original 6-hex-char id was 24
 * bits: with N rows stored, each insert collided with probability N / 2^24 —
 * about 1.6% at 268k rows. That is birthday-shaped against the stored table
 * rather than a concurrency race, which is why it showed up as a steady trickle
 * of `UNIQUE constraint failed: call_logs.id` rather than only under load. The
 * losing insert throws inside `saveCallLogOperation`, which logs and swallows
 * it, so the row disappeared with no signal to the caller.
 *
 * 64 bits matches the width already used by `randomHex(16)` (grok-web) and
 * `randomId(16)` (the OTEL exporter), and takes that same 268k-row collision
 * probability to roughly 1.5e-14 per insert while keeping log lines short.
 *
 * Uses crypto RNG (not `Math.random`) purely to satisfy CodeQL
 * js/insecure-randomness — this id is a log-correlation token and a row key,
 * not a security secret.
 */
export const TRACE_ID_HEX_CHARS = 16;

export function createTraceId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, TRACE_ID_HEX_CHARS);
}
