import { randomUUID } from "node:crypto";
import { TIMELINE, type EncodeResult, type EncodeRun, type Job, type JobStatus } from "@/lib/types";

// Our "database" is two Maps held in memory. `next dev` is a single Node process, so this is fine
// for the exercise. Restarting the dev server wipes everything — that's expected, don't work around it.
//
// Everything in this file is provided EXCEPT computeRun(), which is Task 3.

const jobs = new Map<string, Job>();
const runs = new Map<string, RunRecord>();

export interface RunRecord {
  id: string;
  jobId: string;
  sourceUrl: string;
  /** epoch milliseconds — when Start encode was pressed. */
  startedAt: number;
}

/** The one "magic" source URL that always fails partway, so you can build the error path. */
export const FAIL_URL = "https://cdn.example.com/videos/corrupt.mp4";

// ---------------------------------------------------------------------------
// TASK 3 — the run state machine. This is the most interesting logic in the exercise.
// ---------------------------------------------------------------------------

/**
 * Works out what state a run is in right now.
 *
 * This is a PURE FUNCTION of elapsed time — no timers, no side effects. The
 * same inputs always give the same output, which is why tests can pass `now`
 * directly instead of waiting real seconds.
 *
 * Timeline (from TIMELINE constants in lib/types.ts):
 *
 *   0 ─────── 2s ──────────── 6s ───────────── 12s
 *   │ QUEUED  │ DOWNLOADING   │ TRANSCODING    │ COMPLETED
 *                                    ↑
 *                              8s: FAIL_URL fails here
 *
 * progressPct scales from 0→100 across the full 12s span. For FAILED runs,
 * it is frozen at the percentage reached at failAtMs so it never climbs after
 * the run dies.
 */
export function computeRun(record: RunRecord, now: number = Date.now()): EncodeRun {
  const elapsedMs = now - record.startedAt;
  const { queuedEndsMs, downloadingEndsMs, transcodingEndsMs, failAtMs } = TIMELINE;

  // Check FAILED first — before any stage logic. This is intentional:
  // if we checked stages first, a corrupt run at elapsed >= 12s would return
  // COMPLETED, which must never happen. The failure check must always win.
  if (record.sourceUrl === FAIL_URL && elapsedMs >= failAtMs) {
    // Freeze progress at the percentage the run had reached when it failed,
    // not at the current (larger) elapsed time.
    const progressPct = Math.min(100, Math.floor((failAtMs / transcodingEndsMs) * 100));
    return {
      id: record.id,
      jobId: record.jobId,
      stage: "FAILED",
      progressPct,
      message: "Encode failed: source file is corrupt or unreadable.",
      error: "Source file could not be decoded. Check that the URL points to a valid media file.",
    };
  }

  // Normal stage progression based on elapsed time.
  const progressPct = Math.min(100, Math.floor((elapsedMs / transcodingEndsMs) * 100));

  if (elapsedMs < queuedEndsMs) {
    return {
      id: record.id,
      jobId: record.jobId,
      stage: "QUEUED",
      progressPct,
      message: "Waiting in queue…",
    };
  }

  if (elapsedMs < downloadingEndsMs) {
    return {
      id: record.id,
      jobId: record.jobId,
      stage: "DOWNLOADING",
      progressPct,
      message: "Downloading source file…",
    };
  }

  if (elapsedMs < transcodingEndsMs) {
    return {
      id: record.id,
      jobId: record.jobId,
      stage: "TRANSCODING",
      progressPct,
      message: "Transcoding to 1080p, 720p, 480p…",
    };
  }

  // elapsed >= transcodingEndsMs — run is done.
  return {
    id: record.id,
    jobId: record.jobId,
    stage: "COMPLETED",
    progressPct: 100,
    message: "Encode complete.",
    result: makeResult(),
  };
}

// ---------------------------------------------------------------------------
// Everything below is provided.
// ---------------------------------------------------------------------------

/** Fake but plausible encode output. Call this when a run reaches COMPLETED. */
export function makeResult(): EncodeResult {
  return {
    durationSec: 184,
    renditions: [
      { label: "1080p", width: 1920, height: 1080, sizeMb: 142.6 },
      { label: "720p", width: 1280, height: 720, sizeMb: 68.3 },
      { label: "480p", width: 854, height: 480, sizeMb: 24.1 },
    ],
  };
}

export function listJobs(): Job[] {
  return [...jobs.values()]
    .map(withDerivedStatus)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | null {
  const job = jobs.get(id);
  return job ? withDerivedStatus(job) : null;
}

export function createJob(input: { sourceUrl: string; title?: string }): Job {
  const sourceUrl = input.sourceUrl.trim();
  const job: Job = {
    id: `j_${randomUUID().slice(0, 8)}`,
    title: input.title?.trim() || deriveTitle(sourceUrl),
    sourceUrl,
    status: "NEW",
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function startRun(jobId: string): RunRecord | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  const record: RunRecord = {
    id: `r_${randomUUID().slice(0, 8)}`,
    jobId,
    sourceUrl: job.sourceUrl,
    startedAt: Date.now(),
  };
  runs.set(record.id, record);
  job.latestRunId = record.id;
  return record;
}

export function getRun(id: string, now: number = Date.now()): EncodeRun | null {
  const record = runs.get(id);
  return record ? computeRun(record, now) : null;
}

/**
 * A job's status is derived from its latest run rather than stored, so it can never drift out of
 * sync. Once computeRun() works, job statuses in the list start updating for free.
 */
function withDerivedStatus(job: Job): Job {
  if (!job.latestRunId) return job;
  const record = runs.get(job.latestRunId);
  if (!record) return job;

  let status: JobStatus;
  try {
    const stage = computeRun(record).stage;
    status = stage === "COMPLETED" ? "COMPLETED" : stage === "FAILED" ? "FAILED" : "RUNNING";
  } catch {
    // computeRun isn't implemented yet — leave the stored status alone.
    return job;
  }
  return { ...job, status };
}

function deriveTitle(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "Untitled encode";
  } catch {
    return "Untitled encode";
  }
}

/** Test helper — resets the store between tests. */
export function __resetStore() {
  jobs.clear();
  runs.clear();
}

export { TIMELINE };
