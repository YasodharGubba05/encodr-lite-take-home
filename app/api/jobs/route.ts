import { json, withAuth, readJson, validationError, error } from "@/lib/server/http";
import { createJob, listJobs } from "@/lib/server/store";
import { createJobSchema } from "@/lib/schemas";

// GET /api/jobs — returns every job for the signed-in user, newest first.
// POST /api/jobs — validates the body and creates a new job, or returns 422 with field errors.
//
// Both handlers follow the same pattern as app/api/jobs/[id]/route.ts:
//   withAuth wraps the real work so unauthenticated requests are rejected automatically.
//
// You can test these without any UI — start the dev server and run:
//   curl -i localhost:3000/api/jobs                                  # expect 401
//   TOKEN=$(curl -s localhost:3000/api/auth/login \
//     -H 'content-type: application/json' \
//     -d '{"email":"demo@encodr.dev","password":"password123"}' \
//     | sed 's/.*"token":"\([^"]*\)".*/\1/')
//   curl -i localhost:3000/api/jobs -H "authorization: Bearer $TOKEN"   # expect 200 []
//   curl -i localhost:3000/api/jobs -H "authorization: Bearer $TOKEN" \
//     -H 'content-type: application/json' -d '{"sourceUrl":"nope"}'     # expect 422
//   curl -i localhost:3000/api/jobs -H "authorization: Bearer $TOKEN" \
//     -H 'content-type: application/json' \
//     -d '{"sourceUrl":"https://cdn.example.com/v/clip.mp4"}'           # expect 201

/**
 * GET /api/jobs
 *
 * Returns the full list of jobs, sorted newest-first by listJobs().
 * Requires a valid auth token — withAuth returns 401 automatically if missing.
 */
export async function GET(req: Request) {
  return withAuth(req, () => {
    return json(listJobs());
  });
}

/**
 * POST /api/jobs
 *
 * Creates a new encode job from { sourceUrl, title? } in the request body.
 *
 * Why validate on the server even though the form already validates?
 * The form validation only runs in the browser. Anyone can send a raw curl
 * request (or a buggy client) that skips the form entirely. The server must
 * never trust the client — it validates with the same Zod schema so the rules
 * are identical and the same error messages come back whether you're using the
 * form or a terminal.
 *
 * Returns 201 + the new Job on success, or 422 + per-field messages on failure.
 */
export async function POST(req: Request) {
  return withAuth(req, async () => {
    const body = await readJson(req);
    const parsed = createJobSchema.safeParse(body);

    // If validation fails, return 422 with field-level error messages.
    // The form reads these from parsed.error and puts them under the right input.
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const job = createJob(parsed.data);
    return json(job, 201);
  });
}

