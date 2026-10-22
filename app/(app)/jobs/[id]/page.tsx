"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { jobKeys, useJob, useStartRun } from "@/lib/client/hooks";
import { useRunPolling } from "@/lib/client/use-run-polling";
import { StatusBadge } from "@/components/status-badge";
import { ProgressBar } from "@/components/progress-bar";
import type { Stage } from "@/lib/types";

type PanelStatus = "idle" | "running" | "failed" | "completed";

/**
 * Works out the current display status of the encode run panel from runId and stage.
 *
 * Non-obvious: why we work out status in ONE place as a single discriminated union.
 * Using separate boolean flags like `isRunning`, `isFailed`, and `isCompleted` allows
 * impossible states to occur (such as `isRunning && isFailed`). Calculating a single
 * status value directly from runId and run.stage guarantees that the UI is in exactly
 * one valid state at any given moment.
 *
 * @param runId ID of the active run, or null if no run has started.
 * @param stage Current lifecycle stage of the run.
 * @returns Mutual exclusive status: "idle" | "running" | "failed" | "completed".
 */
function computePanelStatus(runId: string | null, stage: Stage | undefined): PanelStatus {
  if (!runId || !stage) {
    return "idle";
  }
  if (stage === "FAILED") {
    return "failed";
  }
  if (stage === "COMPLETED") {
    return "completed";
  }
  return "running";
}

/**
 * Job detail page displaying metadata, live encode run progress, failure/retry handling,
 * and final transcode rendition results.
 *
 * @param params Route params containing the job ID.
 * @returns JSX element for the job detail view.
 */
export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const jobQuery = useJob(id);
  const queryClient = useQueryClient();

  const job = jobQuery.data;
  const [runId, setRunId] = useState<string | null>(null);

  // Synchronize initial runId with the latestRunId on the job record when first loaded
  const activeRunId = runId ?? job?.latestRunId ?? null;

  const startRunMutation = useStartRun(id);

  // When a run finishes (COMPLETED or FAILED), invalidate queries to refresh job badges
  const onFinished = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
    queryClient.invalidateQueries({ queryKey: jobKeys.all });
  }, [queryClient, id]);

  const { run, fetchError, log } = useRunPolling(activeRunId, onFinished);

  const panelStatus = computePanelStatus(activeRunId, run?.stage);

  const handleStartRun = async () => {
    try {
      const result = await startRunMutation.mutateAsync();
      setRunId(result.runId);
    } catch {
      // Handled via startRunMutation.isError in UI
    }
  };

  if (jobQuery.isLoading) {
    return <p className="text-sm text-neutral-500">Loading job…</p>;
  }

  if (jobQuery.isError || !job) {
    return (
      <div className="text-sm text-red-600">
        Job not found.{" "}
        <Link href="/jobs" className="underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">
        ← All jobs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{job.title}</h1>
          <p className="truncate text-sm text-neutral-500">{job.sourceUrl}</p>
        </div>
        <StatusBadge value={job.status} />
      </div>

      {fetchError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Network error: {fetchError}
        </div>
      )}

      {/* STATE 1: IDLE */}
      {panelStatus === "idle" && (
        <div className="space-y-4 rounded-md border border-neutral-200 p-6 text-center">
          <p className="text-sm text-neutral-500">
            This job has not been encoded yet. Start an encode to generate video renditions.
          </p>
          <button
            type="button"
            onClick={handleStartRun}
            disabled={startRunMutation.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {startRunMutation.isPending ? "Starting…" : "Start encode"}
          </button>
          {startRunMutation.isError && (
            <p className="text-xs text-red-600">
              {startRunMutation.error instanceof Error
                ? startRunMutation.error.message
                : "Failed to start encode"}
            </p>
          )}
        </div>
      )}

      {/* STATE 2: RUNNING */}
      {panelStatus === "running" && run && (
        <div className="space-y-4 rounded-md border border-neutral-200 p-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-50"
            >
              Encoding in progress…
            </button>
            <StatusBadge value={run.stage} />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-neutral-500">
              <span>{run.message}</span>
              <span>{run.progressPct}%</span>
            </div>
            <ProgressBar value={run.progressPct} />
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Progress log
            </h3>
            <div className="space-y-1 rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-700">
              {log.map((message, index) => (
                <p key={index}>{message}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STATE 3: FAILED */}
      {panelStatus === "failed" && run && (
        <div className="space-y-4 rounded-md border border-neutral-200 p-6">
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{run.message}</span>
              <StatusBadge value="FAILED" />
            </div>
            {run.error && <p className="mt-1 text-xs text-red-700">{run.error}</p>}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-neutral-500">
              <span>Progress halted</span>
              <span>{run.progressPct}%</span>
            </div>
            <ProgressBar value={run.progressPct} failed />
          </div>

          <div>
            <button
              type="button"
              onClick={handleStartRun}
              disabled={startRunMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {startRunMutation.isPending ? "Starting…" : "Retry encode"}
            </button>
          </div>

          {log.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Progress log
              </h3>
              <div className="space-y-1 rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-700">
                {log.map((message, index) => (
                  <p key={index}>{message}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STATE 4: COMPLETED */}
      {panelStatus === "completed" && run && (
        <div className="space-y-4 rounded-md border border-neutral-200 p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-neutral-800">
                Encode complete
              </p>
              {run.result && (
                <p className="text-xs text-neutral-500">
                  Duration: {run.result.durationSec}s
                </p>
              )}
            </div>
            <StatusBadge value="COMPLETED" />
          </div>

          <ProgressBar value={100} />

          {run.result && (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Rendition</th>
                    <th className="px-4 py-2">Resolution</th>
                    <th className="px-4 py-2">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {run.result.renditions.map((rendition) => (
                    <tr key={rendition.label}>
                      <td className="px-4 py-2 font-medium">{rendition.label}</td>
                      <td className="px-4 py-2 text-neutral-600">
                        {rendition.width} × {rendition.height}
                      </td>
                      <td className="px-4 py-2 text-neutral-600">
                        {rendition.sizeMb} MB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
