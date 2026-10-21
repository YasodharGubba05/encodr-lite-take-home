import { z } from "zod";

// These schemas are used in TWO places:
//   1. in the browser, as the React Hook Form resolver (instant inline errors), and
//   2. on the server, inside the API route (never trust the browser).
// Sharing one schema means one set of rules and the same error messages in both places.
// A bug in validation is fixed once, not twice.

/**
 * Validates a media source URL for an encode job.
 *
 * Rules, in the order they are checked:
 *   1. Non-empty — Zod's .min(1) fires before .superRefine.
 *   2. Parseable as a URL — new URL() throws on garbage strings like "not a url".
 *   3. http or https protocol — we can't download ftp://, data://, etc.
 *   4. Has a real file path — "https://cdn.example.com" has no file to encode.
 *
 * We use .superRefine() (not multiple .refine() calls) because Zod 4 runs all
 * .refine() calls in parallel — meaning a bad URL would produce errors from both
 * the protocol check AND the path check at the same time. .superRefine() lets us
 * call ctx.addIssue and then return z.NEVER to stop early, so the user always
 * sees exactly ONE message.
 *
 * This same schema runs in the browser (React Hook Form resolver) and on the
 * server (API route), so the rules are written once and can't drift apart.
 */
export const sourceUrlSchema = z
  .string()
  .min(1, "Source URL is required")
  .superRefine((value, ctx) => {
    // Rule 2: must be parseable. new URL() throws on non-URLs like "not a url".
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid URL (e.g. https://example.com/video.mp4)",
      });
      return z.NEVER; // stop here; don't check protocol or path
    }

    // Rule 3: only http and https protocols are supported.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only http and https URLs are supported",
      });
      return z.NEVER; // stop here; don't check path
    }

    // Rule 4: pathname must be more than just "/" — there must be a file to encode.
    // new URL("https://cdn.example.com").pathname === "/" (no real path)
    if (parsed.pathname.length <= 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The URL must include a file path (e.g. /videos/clip.mp4)",
      });
    }
  });

export const createJobSchema = z.object({
  sourceUrl: sourceUrlSchema,
  title: z
    .string()
    .trim()
    .max(80, "Keep the title under 80 characters")
    .optional()
    .or(z.literal("")),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

// Provided, and already used by the working sign-in page. Read it as a reference for the style
// we're after in sourceUrlSchema.
export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const startRunSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
});
