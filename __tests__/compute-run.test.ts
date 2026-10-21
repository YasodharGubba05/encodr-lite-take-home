import { describe, expect, it } from "vitest";
import { computeRun, FAIL_URL } from "@/lib/server/store";
import { TIMELINE } from "@/lib/types";
import type { RunRecord } from "@/lib/server/store";

/**
 * Tests for computeRun().
 *
 * computeRun is a pure function: given a run record and a "current time" (now),
 * it returns the run's current stage, progress, and message. Because we pass
 * `now` in explicitly, we can test any point on the timeline without waiting.
 *
 * Every test builds its time values from TIMELINE constants so they stay in
 * sync with the real implementation — if the constants change, tests update too.
 */

// A base run record used by all tests. startedAt is 0 so that
// passing `now` directly gives us the elapsed time in milliseconds.
const baseRecord: RunRecord = {
  id: "r_test",
  jobId: "j_test",
  sourceUrl: "https://cdn.example.com/videos/clip.mp4",
  startedAt: 0,
};

// A corrupt-URL record that triggers the FAILED path at 8 seconds.
const corruptRecord: RunRecord = {
  ...baseRecord,
  sourceUrl: FAIL_URL,
};

const { queuedEndsMs, downloadingEndsMs, transcodingEndsMs, failAtMs } = TIMELINE;

describe("computeRun — normal URL", () => {
  it("is QUEUED just before the 2-second boundary", () => {
    const run = computeRun(baseRecord, queuedEndsMs - 1);
    expect(run.stage).toBe("QUEUED");
  });

  it("is DOWNLOADING exactly at the 2-second boundary", () => {
    const run = computeRun(baseRecord, queuedEndsMs);
    expect(run.stage).toBe("DOWNLOADING");
  });

  it("is TRANSCODING exactly at the 6-second boundary", () => {
    const run = computeRun(baseRecord, downloadingEndsMs);
    expect(run.stage).toBe("TRANSCODING");
  });

  it("is COMPLETED exactly at the 12-second boundary, with a result", () => {
    const run = computeRun(baseRecord, transcodingEndsMs);
    expect(run.stage).toBe("COMPLETED");
    expect(run.result).toBeDefined();
    expect(run.result?.renditions.length).toBeGreaterThan(0);
  });

  it("has 0% progress at the very start", () => {
    const run = computeRun(baseRecord, 0);
    expect(run.progressPct).toBe(0);
  });

  it("has 100% progress when completed", () => {
    const run = computeRun(baseRecord, transcodingEndsMs);
    expect(run.progressPct).toBe(100);
  });
});

describe("computeRun — corrupt URL (FAIL_URL)", () => {
  it("is still TRANSCODING just before the 8-second failure point", () => {
    const run = computeRun(corruptRecord, failAtMs - 1);
    expect(run.stage).toBe("TRANSCODING");
  });

  it("is FAILED exactly at the 8-second failure point, with an error message", () => {
    const run = computeRun(corruptRecord, failAtMs);
    expect(run.stage).toBe("FAILED");
    expect(run.error).toBeDefined();
    expect(typeof run.error).toBe("string");
  });

  it("is still FAILED after 12 seconds — never flips to COMPLETED", () => {
    // This is the most important correctness property: a failed run must not
    // become COMPLETED even after the normal completion time passes.
    const run = computeRun(corruptRecord, transcodingEndsMs + 1000);
    expect(run.stage).toBe("FAILED");
    expect(run.result).toBeUndefined();
  });

  it("freezes progress at the failure point, not at 100%", () => {
    // Progress should be frozen at the percentage the run was at when it failed,
    // not climb to 100% just because more time has passed.
    const atFailure = computeRun(corruptRecord, failAtMs);
    const afterFailure = computeRun(corruptRecord, transcodingEndsMs);
    expect(atFailure.progressPct).toBe(afterFailure.progressPct);
    expect(atFailure.progressPct).toBeLessThan(100);
  });
});
