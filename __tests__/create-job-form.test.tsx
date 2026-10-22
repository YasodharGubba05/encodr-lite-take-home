import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateJobForm } from "@/components/create-job-form";
import { api, ApiError } from "@/lib/client/api";
import type { Job } from "@/lib/types";

/**
 * Helper to render components wrapped in a fresh React Query client provider.
 *
 * @param ui The React element to render.
 * @returns RenderResult from @testing-library/react.
 */
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const mockJob: Job = {
  id: "j_test123",
  title: "clip.mp4",
  sourceUrl: "https://cdn.example.com/videos/clip.mp4",
  status: "NEW",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("CreateJobForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows validation error on empty submit and does not call api.post", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue(mockJob);

    renderWithClient(<CreateJobForm />);

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    expect(await screen.findByText("Source URL is required")).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("submits valid URL to api.post and resets the form input", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue(mockJob);

    renderWithClient(<CreateJobForm />);

    const urlInput = screen.getByLabelText(/source url/i);
    fireEvent.change(urlInput, {
      target: { value: "https://cdn.example.com/videos/clip.mp4" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/api/jobs", {
        sourceUrl: "https://cdn.example.com/videos/clip.mp4",
        title: "",
      });
    });

    await waitFor(() => {
      expect(urlInput).toHaveValue("");
    });
  });

  it("maps server 422 field errors onto the matching input field", async () => {
    const apiError = new ApiError(422, "Validation failed", {
      sourceUrl: ["Only http and https URLs are supported"],
    });
    vi.spyOn(api, "post").mockRejectedValue(apiError);

    renderWithClient(<CreateJobForm />);

    const urlInput = screen.getByLabelText(/source url/i);
    fireEvent.change(urlInput, {
      target: { value: "https://cdn.example.com/videos/clip.mp4" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    expect(
      await screen.findByText("Only http and https URLs are supported"),
    ).toBeInTheDocument();
  });
});
