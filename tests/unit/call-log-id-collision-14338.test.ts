import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { useDecollidedMigrationsDir } from "./helpers/decollidedMigrationsDir.ts";

useDecollidedMigrationsDir();
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-call-log-collision-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const callLogs = await import("../../src/lib/usage/callLogs.ts");
const artifactWriter = await import("../../src/lib/usage/callLogArtifactWriter.ts");

test.after(async () => {
  await artifactWriter.closeCallLogArtifactWriter();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// #14338: `call_logs.id` is `id TEXT PRIMARY KEY`, and the value written to it is
// chatCore's `traceId`. A duplicate id does not surface to the caller — the insert
// throws inside saveCallLogOperation, which logs and swallows — so the row is lost
// with no signal anywhere except a container log line.
test("a duplicate call-log id is dropped silently, not surfaced", async () => {
  const id = "dup-14338";
  void callLogs.saveCallLog({
    id,
    timestamp: "2026-09-21T10:00:00.000Z",
    status: 200,
    model: "model-a",
    provider: "provider-a",
  });
  assert.equal(await callLogs.waitForCallLogSaves(10_000), true);

  // Same id, different payload — this is the "second request" in the bug report.
  await callLogs.saveCallLog({
    id,
    timestamp: "2026-09-21T10:00:01.000Z",
    status: 500,
    model: "model-b",
    provider: "provider-b",
  });
  assert.equal(await callLogs.waitForCallLogSaves(10_000), true);

  const rows = core
    .getDbInstance()
    .prepare(`SELECT id, model, provider, status FROM call_logs WHERE id = ?`)
    .all(id) as Array<{ model: string; provider: string; status: number }>;

  assert.equal(rows.length, 1, "PRIMARY KEY keeps exactly one row");
  // The SECOND call is the one lost: the analytics row for a 500 never lands.
  assert.equal(rows[0].model, "model-a");
  assert.equal(rows[0].status, 200);
});

// The guard for the root cause. `call_logs.id TEXT PRIMARY KEY` is fed by
// chatCore's traceId, so the id must be wide enough that collisions against an
// already-populated table stay negligible. The old generator was
// `randomUUID().slice(0, 6)` — 24 bits, ~1.6% per insert at 268k stored rows.
const { createTraceId, TRACE_ID_HEX_CHARS } =
  await import("../../open-sse/handlers/chatCore/traceId.ts");

test("trace ids are wide enough to be a call_logs primary key", () => {
  // 24 bits is the width that produced the reported failures; require >= 64.
  assert.ok(
    TRACE_ID_HEX_CHARS >= 16,
    `trace id must be at least 16 hex chars (64 bits), got ${TRACE_ID_HEX_CHARS}`
  );

  const id = createTraceId();
  assert.equal(id.length, TRACE_ID_HEX_CHARS);
  assert.match(id, /^[0-9a-f]+$/, "hex only, so it is safe in log lines and as a key");
});

test("a realistic table's worth of trace ids contains no duplicate", () => {
  // 200k draws is the order of magnitude at which the 24-bit id collided
  // constantly (P ~ 1 at 50k) and at which a 64-bit id effectively never does
  // (P ~ 1e-9 across the whole run), so this fails loudly on a narrowed id
  // without being flaky on a correct one.
  const draws = 200_000;
  const seen = new Set<string>();
  let firstCollision: string | null = null;
  for (let i = 0; i < draws; i++) {
    const id = createTraceId();
    if (seen.has(id)) {
      firstCollision = id;
      break;
    }
    seen.add(id);
  }
  assert.equal(
    firstCollision,
    null,
    `duplicate trace id ${firstCollision} within ${draws} draws — the id is too narrow to key call_logs`
  );
  assert.equal(seen.size, draws);
});
