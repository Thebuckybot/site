// Node test for the recovery-poll contract (SV2-MAN-005 / 005B).
// Run: node site/js/security/pages/recovery_poll.test.mjs
import { validJobId, isTerminal, isPreviewReady, pollOutcome } from "./recovery_poll.js";

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL:", msg); } }

// validJobId
ok(validJobId(5), "positive int is valid");
ok(!validJobId(0), "0 invalid");
ok(!validJobId(null), "null invalid");
ok(!validJobId(NaN), "NaN invalid");

// isTerminal / isPreviewReady
ok(isTerminal("succeeded") && isTerminal("failed") && isTerminal("stale"), "terminal set");
ok(!isTerminal("previewed"), "previewed is NOT execution-terminal");
ok(isPreviewReady("previewed"), "previewed is preview-ready");
ok(!isPreviewReady("planned"), "planned is not preview-ready");

// pollOutcome — the core lifecycle contract
ok(pollOutcome({ job: { status: "planned" } }) === "continue", "planned -> keep polling");
ok(pollOutcome({ job: { status: "previewed" } }) === "preview-ready", "previewed -> STOP (ready)");
ok(pollOutcome({ job: { status: "queued" } }) === "continue", "queued -> keep polling");
ok(pollOutcome({ job: { status: "running" } }) === "continue", "running -> keep polling");
ok(pollOutcome({ job: { status: "succeeded" } }) === "terminal", "succeeded -> STOP (terminal)");
ok(pollOutcome({ job: { status: "failed" } }) === "terminal", "failed -> STOP (terminal)");
ok(pollOutcome({ error: { status: 404 } }) === "stop-404", "404 -> stop");
ok(pollOutcome({ error: { status: 500 } }) === "retry", "5xx -> retry");
ok(pollOutcome({ job: {} }) === "stop-malformed", "no status -> malformed");

// A completed ZERO-OP preview is status 'previewed' with empty operations — must
// still STOP (never inferred from operations.length).
ok(pollOutcome({ job: { status: "previewed", operations: [] } }) === "preview-ready",
   "zero-op previewed still stops polling");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
