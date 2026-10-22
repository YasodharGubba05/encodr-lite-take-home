"use client";

import { useEffect, useRef, useState } from "react";
import { isTerminalStage, type EncodeRun } from "@/lib/types";
import { fetchRun } from "@/lib/client/hooks";

export interface RunPollingState {
  /** The latest run state we've received, or null before the first response. */
  run: EncodeRun | null;
  /** True while we're still asking the server for updates. */
  polling: boolean;
  /** A request failed (network, 404, …). Not the same thing as the RUN failing. */
  fetchError: string | null;
  /** Every message we've seen, oldest first — the log the UI renders. */
  log: string[];
}

const initialState: RunPollingState = {
  run: null,
  polling: false,
  fetchError: null,
  log: [],
};

/**
 * Custom hook to poll the status of an encode run at ~1s intervals until a terminal
 * stage (COMPLETED or FAILED) is reached.
 *
 * @param runId ID of the run to poll, or null if no run is currently active.
 * @param onFinished Optional callback fired once when the run enters a terminal stage.
 * @returns Current RunPollingState including the latest run, polling flag, error, and message logs.
 */
export function useRunPolling(runId: string | null, onFinished?: () => void): RunPollingState {
  const [state, setState] = useState<RunPollingState>(initialState);

  // Keep onFinished in a ref so changes to the callback identity do not restart the polling effect.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    // When runId is null, do not start polling.
    if (!runId) {
      setState(initialState);
      return;
    }

    const activeRunId = runId;

    // Reset state when starting a new run.
    setState({
      run: null,
      polling: true,
      fetchError: null,
      log: [],
    });

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let finished = false;

    async function poll() {
      try {
        const run = await fetchRun(activeRunId);
        // Non-obvious: why we check `cancelled` after every await.
        // If the component unmounted while fetchRun was in-flight, setting state would
        // cause memory leaks and React warnings on unmounted components.
        if (cancelled) return;

        setState((prev) => {
          // Append run.message to log unless it equals the last message seen
          const lastMessage = prev.log.length > 0 ? prev.log[prev.log.length - 1] : null;
          const newLog =
            run.message && run.message !== lastMessage
              ? [...prev.log, run.message]
              : prev.log;

          const terminal = isTerminalStage(run.stage);
          return {
            run,
            polling: !terminal,
            fetchError: null,
            log: newLog,
          };
        });

        // When a terminal stage is reached (COMPLETED or FAILED), stop future ticks
        // and notify onFinished once.
        if (isTerminalStage(run.stage) && !finished) {
          finished = true;
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
          onFinishedRef.current?.();
        }
      } catch (error) {
        if (cancelled) return;
        // On network or request failure, stop polling and record error
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        setState((prev) => ({
          ...prev,
          polling: false,
          fetchError: error instanceof Error ? error.message : "Failed to fetch run status",
        }));
      }
    }

    // Poll immediately on mount or runId change
    void poll();

    // Schedule regular polling every 1000ms
    intervalId = setInterval(() => {
      if (cancelled || finished) return;
      void poll();
    }, 1000);

    return () => {
      // Non-obvious: why we need BOTH clearInterval and the cancelled flag.
      // 1. clearInterval stops future timer callbacks from firing, avoiding runaway background intervals.
      // 2. cancelled flag guards any asynchronous fetch that is ALREADY in-flight when unmount happens,
      //    preventing setState from executing after the component has unmounted.
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, [runId]);

  return state;
}
