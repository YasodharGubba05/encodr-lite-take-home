# Encodr Lite — Media Transcoding Dashboard

Encodr Lite is a media-transcoding dashboard built with **Next.js (App Router)**, **React**, **TypeScript**, **React Query**, **React Hook Form**, **Zod**, and **Vitest**. A signed-in user creates an encode **job** from a media source URL, clicks **Start encode**, watches progress update live with real-time logs, and inspects the output renditions upon completion (or reviews failure details and retries).

---

## Getting Started

```bash
npm install
npm run dev          # Start local dev server (http://localhost:3000)
npm run test:run     # Run Vitest test suite
npm run typecheck    # Validate TypeScript types (tsc --noEmit)
npm run build        # Production Next.js build
```

Requires **Node 20+** (see `.nvmrc`).

**Demo Login Credentials:**
- **Email:** `demo@encodr.dev`
- **Password:** `password123`

---

## Project Structure

```
app/
  signin/page.tsx              Working sign-in (RHF + Zod reference)
  (app)/layout.tsx             Route guard for authenticated routes
  (app)/jobs/page.tsx          Jobs overview and CreateJobForm mount
  (app)/jobs/[id]/page.tsx     Job detail view: run controls, live progress, results
  api/auth/login/route.ts      Login route (issues JWT tokens)
  api/jobs/route.ts            GET (list jobs) and POST (create job with validation)
  api/jobs/[id]/route.ts       GET single job detail
  api/runs/route.ts            POST (start an encode run)
  api/runs/[id]/route.ts       GET (poll run progress)
lib/
  types.ts                     Shared data models and TIMELINE constants
  schemas.ts                   Zod schemas (sourceUrlSchema, createJobSchema, loginSchema)
  server/store.ts              In-memory store and computeRun() state machine
  server/http.ts               HTTP helpers (json, error, withAuth, validationError)
  client/api.ts                API client with fetch wrapper and ApiError
  client/hooks.ts              React Query hooks (useJobs, useJob, useStartRun, useCreateJob, fetchRun)
  client/use-run-polling.ts    Polling hook with timer cleanup and cancelled guard
components/
  create-job-form.tsx          Job creation form with client & server error handling
  status-badge.tsx             Stage and JobStatus badges
  progress-bar.tsx             Animated percentage bar with failure state
__tests__/
  schemas.test.ts              Unit tests for sourceUrlSchema
  compute-run.test.ts          Boundary and failure tests for computeRun() state machine
  create-job-form.test.tsx     Component tests for CreateJobForm validation and submission
```

---

# Candidate Write-up

### What's working

All six tasks specified in `BRIEF.md` are completed and verified:

1. **Source-URL validation (`lib/schemas.ts`)**: `sourceUrlSchema` validates URLs requiring `http:` or `https:` protocols and a non-empty file path (e.g. `/videos/clip.mp4`). Built with Zod `superRefine` so that malformed inputs produce exactly one clear, targeted error message without parallel refinement exceptions.
2. **Jobs API routes (`app/api/jobs/route.ts`)**: `GET /api/jobs` returns the job list for the authenticated user. `POST /api/jobs` validates incoming payloads with `createJobSchema` on the server and returns 422 with structured `fieldErrors` on failure, or creates the job and returns 201 on success.
3. **Run state machine (`lib/server/store.ts` → `computeRun`)**: A pure function of elapsed time that calculates stages across the exact timeline (`QUEUED` < 2s, `DOWNLOADING` < 6s, `TRANSCODING` < 12s, and `COMPLETED` at 12s with renditions). The failure condition for `FAIL_URL` is evaluated first so that corrupt runs freeze at 8s (~66% progress) and never flip to `COMPLETED`.
4. **Create-job form (`components/create-job-form.tsx` & `app/(app)/jobs/page.tsx`)**: Built using React Hook Form with `zodResolver(createJobSchema)`. Inputs feature accessible labels, disabled states during submission, and inline error messages. Server 422 validation errors are mapped back to specific fields via `setError`, and `jobKeys.all` is invalidated on success to update the list without page reload.
5. **Live progress and results (`lib/client/use-run-polling.ts` & `app/(app)/jobs/[id]/page.tsx`)**: Polling hook requests `/api/runs/:id` every 1000ms and halts immediately upon reaching a terminal stage (`COMPLETED` or `FAILED`). The detail page UI is modeled as a single discriminated state union (`idle | running | failed | completed`) displaying live stage badges, progress bars, chronological progress logs, error alerts with retry capabilities, and the final renditions table.
6. **Automated tests (`__tests__/`)**: 20 automated Vitest tests covering schema validation rules, state machine timeline boundaries, corrupt URL failure handling, and component form validation/submission behavior.

### How to see the failure path

1. Sign in to the application at `http://localhost:3000` (`demo@encodr.dev` / `password123`).
2. In the **New encode job** form, submit the corrupt media URL:
   `https://cdn.example.com/videos/corrupt.mp4`
3. Click the newly created job in the list to open `/jobs/[id]`.
4. Click **Start encode**.
5. The run progresses through `QUEUED` (0–2s) and `DOWNLOADING` (2–6s) into `TRANSCODING`.
6. At exactly 8 seconds (`TIMELINE.failAtMs`), the run enters the `FAILED` stage.
7. The UI immediately halts polling, turns the progress bar red (frozen at ~66%), displays a red alert banner with the server error message (`"Source file could not be decoded..."`), and provides a **Retry encode** button.
8. Clicking **Retry encode** starts a new encode run and resets the progress cycle.

### Decisions and assumptions

- **Detail Page State Modeling**: The panel status is derived in a single function as `"idle" | "running" | "failed" | "completed"` based on `activeRunId` and `run?.stage`. We explicitly avoid maintaining separate boolean flags (e.g. `isRunning`, `isFailed`, `isCompleted`) because combinations like `isRunning && isFailed` represent impossible states. A single discriminated union guarantees that the UI can only ever exist in one valid state.
- **Polling Cleanup Architecture**: Polling cleanup in `useRunPolling` requires both `clearInterval` and a `cancelled` boolean guard:
  - `clearInterval` stops future interval ticks when the component unmounts or `runId` changes, preventing background timer leaks.
  - The `cancelled` boolean guards asynchronous promises (`await fetchRun(...)`) already in-flight when unmount occurs, ensuring `setState` is never invoked on an unmounted component.
  - The `onFinished` callback is stored in a `useRef` so changing the callback reference never restarts the polling timer.
- **Standalone `fetchRun` vs React Query Polling**: We chose a small `fetchRun(runId, signal)` helper in `hooks.ts` paired with a custom `useRunPolling` hook rather than `useQuery` with `refetchInterval`. This gave us exact, transparent control over stopping intervals on terminal stages, collecting append-only non-duplicate log messages, and cleaning up in-flight requests on unmount.
- **Zod 4 `superRefine`**: In Zod 4, chained `.refine()` calls run in parallel. Evaluating `new URL()` or path checks concurrently on invalid strings can throw unhandled exceptions or produce multiple redundant validation errors. Using `.superRefine` with early `return z.NEVER` guarantees sequential validation, ensuring exactly one clear message is returned.
- **Dual Client & Server Validation**: Client validation provides instant UX feedback before sending a network request. Server validation with the same `createJobSchema` guarantees data integrity regardless of the client (curl, external API consumers, or bypassed frontends).

### What was hardest

The trickiest part was Zod 4's parallel refinement behavior. In older Zod versions, chained `.refine()` calls evaluated sequentially. In Zod 4, chaining caused `new URL()` in the second refine to throw a runtime `TypeError` when tested with non-URL strings like `"not a url"`, and caused malformed URLs to emit multiple error issues simultaneously. 

To resolve this cleanly without loose regexes, we switched to `z.string().superRefine((val, ctx) => { ... })`. We wrapped `new URL(val)` in a `try/catch` and returned `z.NEVER` immediately if URL parsing failed or if the protocol was unsupported. This guaranteed sequential execution and clean, single-message error reporting.

Another important detail was the dual cleanup in `useRunPolling`: understanding that `clearInterval` alone does not cancel a fetch request that is already over the network wire. Adding the `cancelled` boolean check after every `await` resolved potential state updates on unmounted components.

### What I'd do next

With an extra day, I would add:
1. **Tab Visibility Awareness**: Pause the polling interval when the browser tab is hidden using `document.visibilityState`, and immediately fire a poll when the tab becomes visible again.
2. **Progress Bar Smoothing**: Interpolate progress percentage smoothly across the 1-second interval ticks using CSS transitions or `requestAnimationFrame`.
3. **Database Persistence**: Replace the in-memory `Map` store with a persistent database (e.g., PostgreSQL with Prisma or Drizzle) so runs and jobs survive server restarts.
4. **WebSocket / Server-Sent Events (SSE)**: For production scale, replace 1-second HTTP polling with Server-Sent Events to stream stage transitions and log lines from the server in real time.

### Time spent

Approximately **4 hours** total:
- Setup, review of starter code, and baseline verification: ~30 min
- Task 1 (Zod schemas and tests): ~30 min
- Task 2 (Jobs API routes and curl verification): ~30 min
- Task 3 (computeRun state machine, TDD tests): ~45 min
- Task 4 (Create job form and server error mapping): ~45 min
- Task 5 (Polling hook with cleanup and run panel UI): ~45 min
- Task 6 (Component tests and documentation write-up): ~30 min
