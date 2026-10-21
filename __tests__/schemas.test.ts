import { describe, expect, it } from "vitest";
import { sourceUrlSchema } from "@/lib/schemas";

/**
 * Tests for sourceUrlSchema.
 *
 * We test both the "happy path" (URLs we expect to accept) and each specific
 * rejection case with its own message. Running these BEFORE the implementation
 * confirms the tests are real — a test that can never fail isn't useful.
 */
describe("sourceUrlSchema", () => {
  // --- URLs that should be accepted ---

  it("accepts a valid https URL with a file path", () => {
    const result = sourceUrlSchema.safeParse(
      "https://cdn.example.com/videos/clip.mp4",
    );
    expect(result.success).toBe(true);
  });

  it("accepts a valid http URL with a nested path", () => {
    const result = sourceUrlSchema.safeParse(
      "http://media.example.com/a/b/movie.mov",
    );
    expect(result.success).toBe(true);
  });

  // --- URLs that should be rejected, each with a specific message ---

  it('rejects an empty string with "Source URL is required"', () => {
    const result = sourceUrlSchema.safeParse("");
    expect(result.success).toBe(false);
    // Zod's .min(1) fires before our refines, so the empty-string message comes from there.
    expect(result.error?.issues[0].message).toBe("Source URL is required");
  });

  it('rejects a plain string that is not a URL at all', () => {
    const result = sourceUrlSchema.safeParse("not a url");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/valid URL/i);
  });

  it('rejects an ftp:// URL with an "only http/https" message', () => {
    const result = sourceUrlSchema.safeParse(
      "ftp://cdn.example.com/clip.mp4",
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/http/i);
  });

  it('rejects a URL with no file path with a "path" message', () => {
    const result = sourceUrlSchema.safeParse("https://cdn.example.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/path/i);
  });

  it("shows only ONE error message even when multiple rules would fire", () => {
    // An ftp:// URL with no path would break two rules. We expect exactly one message,
    // because Zod 4 stops running refines as soon as one returns false by default.
    const result = sourceUrlSchema.safeParse("ftp://cdn.example.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
  });
});
