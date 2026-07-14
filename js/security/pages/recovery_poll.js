// Pure, browser-free helpers for the Rollback recovery-job polling contract.
// Extracted so the id/404/malformed/terminal decisions are unit-testable in Node
// (no DOM / api imports). Used by rollback.js. (SV2-MAN-005 /recovery/job/0 fix.)

export const TERMINAL = ["succeeded", "partial", "failed", "stale", "cancelled"];

// A recovery job id must be a positive integer. Never poll 0/null/undefined/NaN.
export function validJobId(v) {
  return v != null && Number.isInteger(Number(v)) && Number(v) > 0;
}

export function isTerminal(status) {
  return TERMINAL.includes(status);
}

// SV2-MAN-005B recovery-preview lifecycle: 'previewed' is an EXPLICIT completion
// state (plan generation finished). Polling must stop on it — the frontend must
// NOT infer completion from operations.length (a placeholder/zero-op plan is [] too).
export function isPreviewReady(status) {
  return status === "previewed";
}

// Decide what a poll cycle should do given the fetch error (if any) and job body.
// Returns: "stop-404" | "retry" | "stop-malformed" | "preview-ready" | "terminal" | "continue".
// Both "preview-ready" and "terminal" mean STOP polling; the caller renders per status.
export function pollOutcome({ error, job } = {}) {
  if (error) {
    return (error.status === 404 || error.status === 410) ? "stop-404" : "retry";
  }
  if (!job || typeof job.status !== "string") return "stop-malformed";
  if (isPreviewReady(job.status)) return "preview-ready";
  return isTerminal(job.status) ? "terminal" : "continue";
}
