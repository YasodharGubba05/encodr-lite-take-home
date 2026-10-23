# Encodr Lite — Intern Take-Home

Thanks for taking the time on this. **Encodr Lite** is a small media-transcoding dashboard: a
signed-in user creates an encode **job** from a media URL, presses **Start encode**, watches the
progress update live, and sees the output files when it finishes.

The full brief — the six tasks, what we look for, and the ground rules — is in **`BRIEF.md`**.
**Read that first.** This file is just how to run things, and it's where you write up your work when
you're done.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run test:run     # tests (20 tests, all passing)
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

Requires **Node 20+** (`.nvmrc` says 20).

**Demo login:** `demo@encodr.dev` / `password123`

Nothing here needs a database. State lives in memory, so restarting the dev server wipes your jobs.
That's fine — don't work around it.

## Where things are

```
app/
  signin/page.tsx              working sign-in — your example of RHF + Zod
  (app)/layout.tsx             route guard for everything signed-in
  (app)/jobs/page.tsx          TASK 4 — the create-job form
  (app)/jobs/[id]/page.tsx     TASK 5 — run controls, progress, results
  api/auth/login/route.ts      provided
  api/jobs/route.ts            TASK 2 — list + create
  api/jobs/[id]/route.ts       provided — your example route handler
  api/runs/route.ts            provided — starts a run
  api/runs/[id]/route.ts       provided — the endpoint you'll poll
lib/
  types.ts                     the data model + the run TIMELINE. Read this first.
  schemas.ts                   TASK 1 — source-URL validation
  server/auth.ts               provided — token signing
  server/http.ts               provided — json / error / withAuth / validationError
  server/store.ts              TASK 3 — computeRun()
  client/api.ts                provided — the fetch wrapper
  client/auth-context.tsx      provided
  client/hooks.ts              worked React Query examples + two TODOs
  client/use-run-polling.ts    TASK 5 — the polling hook
components/
  create-job-form.tsx          TASK 4 — isolated, testable create-job form component
  status-badge.tsx             provided — StatusBadge
  progress-bar.tsx             provided — ProgressBar
__tests__/
  schemas.test.ts              TASK 1 — sourceUrlSchema tests
  compute-run.test.ts          TASK 3 — computeRun timeline boundary tests (TDD)
  create-job-form.test.tsx     TASK 6 — form validation and submission component tests
```

## Useful to know

- `https://cdn.example.com/videos/corrupt.mp4` is rigged to **fail** partway through its run. Use it
  to build the error path.
- A run takes about **12 seconds** from start to finish, so you won't be waiting around.
- Run timings are constants in `TIMELINE` (`lib/types.ts`). Use them instead of typing numbers, so
  your tests and ours agree.
- `computeRun` takes `now` as an argument on purpose — you can test the 8-second mark without
  waiting eight seconds.

---

# Your write-up

Please replace this section before submitting. See `BRIEF.md` §6 for what we're after.

### What's working

All six tasks are fully implemented, passing typechecks and tests, with no incomplete or knowingly broken parts:

1. **Task 1 — Source URL validation (`lib/schemas.ts`)**: `sourceUrlSchema` validates that URLs are non-empty, parseable as valid URLs, use `http:` or `https:`, and include a file path (e.g. `/videos/clip.mp4`). Implemented using Zod `superRefine` so that malformed inputs produce exactly one targeted error message.
2. **Task 2 — Jobs API routes (`app/api/jobs/route.ts`)**: `GET /api/jobs` returns the user's jobs list. `POST /api/jobs` validates the request body using `createJobSchema` and returns a 422 with structured `fieldErrors` on failure, or creates the job and returns 201 on success. Both routes are protected with `withAuth`.
3. **Task 3 — Run state machine (`lib/server/store.ts` → `computeRun`)**: Implemented as a pure function of elapsed time matching the `TIMELINE` constants (`QUEUED` < 2s, `DOWNLOADING` < 6s, `TRANSCODING` < 12s, `COMPLETED` at 12s with renditions). The `FAIL_URL` check is evaluated first so that corrupt runs freeze at 8s (~66%) and never transition to `COMPLETED`.
4. **Task 4 — Create-job form (`components/create-job-form.tsx`, `app/(app)/jobs/page.tsx`)**: Created `CreateJobForm` using React Hook Form and `zodResolver(createJobSchema)`. Displays inline validation errors, disables inputs while submitting, resets on success, and maps server 422 `fieldErrors` back to individual fields via `setError`. On success, it invalidates `jobKeys.all` so the list updates without a reload.
5. **Task 5 — Live progress and results (`lib/client/use-run-polling.ts`, `app/(app)/jobs/[id]/page.tsx`)**: The polling hook polls `/api/runs/:id` every 1000ms and cleans up properly. The run panel is modeled with a single state union (`idle | running | failed | completed`) displaying live stage badges, progress percentage, message logs, error alert with retry button for corrupt runs, and final duration with renditions table upon completion.
6. **Task 6 — Tests (`__tests__/`)**: 20 automated tests in Vitest covering `sourceUrlSchema` validation cases, all `computeRun` boundary conditions and corrupt URL failure handling, and `CreateJobForm` validation/submission behavior.

### How to see the failure path

1. Sign in with the demo account: `demo@encodr.dev` / `password123`.
2. On `/jobs`, create a new job using the corrupt URL:
   `https://cdn.example.com/videos/corrupt.mp4`
3. Click the new job in the list to open its detail page (`/jobs/[id]`).
4. Click **Start encode**.
5. The run progresses through `QUEUED` (0–2s) and `DOWNLOADING` (2–6s) into `TRANSCODING`.
6. At exactly 8 seconds (`TIMELINE.failAtMs`), the run transitions to `FAILED`:
   - Polling stops immediately.
   - The progress bar turns red and freezes at 66% (8000ms / 12000ms).
   - A red alert panel displays the error message: *"Source file could not be decoded. Check that the URL points to a valid media file."*
   - A **Retry encode** button is displayed. Clicking it starts a new run and restarts the pipeline cleanly.

### Decisions and assumptions

- **Detail Page State Modeling**: Modeled as a single discriminated union `type PanelStatus = "idle" | "running" | "failed" | "completed"`, computed in one function from `runId` and `run?.stage`. We avoided multiple independent booleans (`isRunning`, `isFailed`, `isCompleted`) because combinations like `isRunning && isFailed` create contradictory, impossible states. A single union guarantees the UI is always in exactly one valid state.
- **Dual Cleanup in `useRunPolling`**: We used both `clearInterval` and a `cancelled` boolean guard:
  - `clearInterval`: Stops future timer ticks when unmounting or when `runId` changes, preventing runaway background intervals.
  - `cancelled` flag: Guards asynchronous network requests (`await fetchRun(...)`) already in-flight when unmount happens, preventing `setState` from being called on an unmounted component.
  - `onFinishedRef`: Wrapped `onFinished` in a React ref so parent identity changes never restart the polling interval.
- **Standalone `fetchRun` vs React Query Polling**: We implemented a dedicated `fetchRun(runId, signal)` helper in `hooks.ts` paired with `useRunPolling` rather than `useQuery({ refetchInterval })`. This provided explicit, transparent control over stopping intervals immediately upon reaching terminal stages (`COMPLETED` or `FAILED`), collecting append-only deduplicated logs, and managing unmount cleanup guarantees.
- **Zod 4 `superRefine`**: In Zod 4, chained `.refine()` calls run concurrently. To prevent parallel evaluation where `new URL()` would throw unhandled exceptions or emit multiple errors for a single malformed URL, we used `.superRefine` with early `return z.NEVER` so invalid inputs produce exactly one clear error message.
- **Form Component Isolation**: Extracted `CreateJobForm` into `components/create-job-form.tsx` to keep the form clean and independently unit-testable in isolation using `@testing-library/react`.
- **Assumptions**: In-memory storage is wiped on dev server restarts (per the brief). If `runId` changes, polling state resets.

### What was hardest

The trickiest part was navigating Zod 4's parallel refinement behavior. In older Zod versions, chained `.refine()` calls ran sequentially. In Zod 4, chaining caused tests with strings like `"not a url"` to throw an unhandled `TypeError` inside `new URL()` in the subsequent refine, and caused `ftp://` without a path to produce two error messages simultaneously. 

After reviewing Zod 4's issue reporting model, I refactored `sourceUrlSchema` to use `superRefine` with `try / catch` around `new URL()` and early returns (`return z.NEVER`). This guaranteed sequential validation and clean, single-message error reporting.

Another subtle area was understanding why `clearInterval` alone does not fully clean up an effect: `clearInterval` only cancels future ticks, but an HTTP fetch that has already left the browser will still resolve after unmount. Adding the `cancelled` boolean guard after every `await` resolved potential state updates on unmounted components.

### What I'd do next

With an extra day, I would add:
1. **Tab Visibility Awareness**: Pause polling when the browser tab is hidden using `document.visibilityState`, and immediately fire a poll when the user returns.
2. **Smooth Progress Transitions**: Interpolate progress percentage smoothly between the 1-second polling ticks using CSS transitions or `requestAnimationFrame`.
3. **Relative Timestamps**: Show relative timestamps (e.g. "created 2 minutes ago") in the jobs list.
4. **Persistent Database**: Replace the in-memory `Map` store with SQLite or PostgreSQL via Drizzle/Prisma so jobs and runs persist across restarts.
5. **Server-Sent Events (SSE)**: For production scale, replace 1-second HTTP polling with SSE or WebSockets to stream stage transitions and log lines from the server in real time.

### Time spent

Approximately **4 hours** total:
- Setup, codebase exploration, baseline verification: ~30 min
- Task 1 (Zod schemas & unit tests): ~30 min
- Task 2 (Jobs API routes & curl verification): ~30 min
- Task 3 (computeRun state machine, TDD tests first): ~45 min
- Task 4 (Create-job form & server error mapping): ~45 min
- Task 5 (Polling hook with dual cleanup & detail page run panel): ~45 min
- Task 6 (Component tests, README write-up & final checks): ~35 min
