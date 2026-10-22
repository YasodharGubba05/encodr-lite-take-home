"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { CreateJobInput } from "@/lib/schemas";
import type { EncodeRun, Job } from "@/lib/types";

// TanStack Query (React Query) handles server data for us: caching, loading and error flags,
// and refetching. The rule of thumb: useQuery for READING, useMutation for WRITING.
//
// Three worked examples are below. Then two TODOs that follow the same patterns.

/**
 * Query keys are how React Query identifies cached data. Keeping them in one object means you
 * can't typo one half of a pair and wonder why the cache never updates.
 */
export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
  run: (runId: string) => ["runs", runId] as const,
};

// --- WORKED EXAMPLE 1: reading a list ---
export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: ({ signal }) => api.get<Job[]>("/api/jobs", signal),
  });
}

// --- WORKED EXAMPLE 2: reading one item ---
export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) => api.get<Job>(`/api/jobs/${id}`, signal),
  });
}

// --- WORKED EXAMPLE 3: writing, then invalidating the cache ---
//
// After a successful write, the cached data we hold is stale. `invalidateQueries` tells React
// Query "this data is out of date, refetch it" — which is how the UI updates without a reload.
export function useStartRun(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ runId: string }>("/api/runs", { jobId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

/**
 * Mutation hook for creating a new video encoding job.
 * Sends a POST request to /api/jobs with the validated job inputs.
 * On success, invalidates jobKeys.all so the jobs list refetches automatically.
 *
 * @returns React Query mutation object for creating jobs.
 */
export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateJobInput) => api.post<Job>("/api/jobs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

/**
 * Fetches the current state of a single encode run.
 *
 * @param runId The ID of the run to fetch.
 * @param signal Optional AbortSignal to cancel an in-flight request.
 * @returns Promise resolving to the current EncodeRun.
 */
export function fetchRun(runId: string, signal?: AbortSignal): Promise<EncodeRun> {
  return api.get<EncodeRun>(`/api/runs/${runId}`, signal);
}

export type { EncodeRun, Job, CreateJobInput };
