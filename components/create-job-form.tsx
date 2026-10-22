"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createJobSchema, type CreateJobInput } from "@/lib/schemas";
import { useCreateJob } from "@/lib/client/hooks";
import { ApiError } from "@/lib/client/api";

/**
 * Form component to create a new encode job.
 * Uses React Hook Form with Zod validation on the client, and maps server-side
 * validation errors back to individual fields upon 422 responses.
 *
 * @returns JSX element containing the job creation form.
 */
export function CreateJobForm() {
  const [generalError, setGeneralError] = useState<string | null>(null);
  const createJobMutation = useCreateJob();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: {
      sourceUrl: "",
      title: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setGeneralError(null);
    try {
      await createJobMutation.mutateAsync(values);
      reset();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) {
        // Non-obvious: why the form maps server fieldErrors onto fields.
        // Even though client validation caught initial schema errors, the server is the
        // authoritative validator (defense-in-depth). If the server returns a 422 with
        // field-specific errors, mapping them back to the exact input via setError ensures
        // the user sees the error message directly under the offending input field.
        let hasMappedField = false;
        if (error.fieldErrors.sourceUrl && error.fieldErrors.sourceUrl.length > 0) {
          setError("sourceUrl", { message: error.fieldErrors.sourceUrl[0] });
          hasMappedField = true;
        }
        if (error.fieldErrors.title && error.fieldErrors.title.length > 0) {
          setError("title", { message: error.fieldErrors.title[0] });
          hasMappedField = true;
        }
        if (!hasMappedField) {
          setGeneralError(error.message || "Validation failed");
        }
      } else {
        // Non-obvious: general error path.
        // If the error is not a 422 field error (e.g., 500 server crash, network drop, 401 unauth),
        // we display a single general error message under the form since no specific field is at fault.
        setGeneralError(error instanceof Error ? error.message : "Failed to create job");
      }
    }
  });

  const isPending = isSubmitting || createJobMutation.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-neutral-200 p-4" noValidate>
      <div>
        <label htmlFor="sourceUrl" className="mb-1 block text-sm font-medium">
          Source URL
        </label>
        <input
          id="sourceUrl"
          {...register("sourceUrl")}
          type="text"
          placeholder="https://cdn.example.com/videos/clip.mp4"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          autoComplete="off"
        />
        {errors.sourceUrl && (
          <p className="mt-1 text-xs text-red-600">{errors.sourceUrl.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title (optional)
        </label>
        <input
          id="title"
          {...register("title")}
          type="text"
          placeholder="My video title"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          autoComplete="off"
        />
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>

      {generalError && <p className="text-sm text-red-600">{generalError}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create job"}
      </button>
    </form>
  );
}
