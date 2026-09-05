import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import SettingsPage from "@/pages/SettingsPage";

// Radix Select needs these in jsdom (see AiProviderSection.test.tsx for the full
// rationale) — AiProviderSection is mounted as part of this page.
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

function renderSettingsPage(settingsEntry = "/settings") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/", settingsEntry]} initialIndex={1}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/" element={<div>Previous screen</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsPage — AI Meal Planning section", () => {
  beforeEach(() => {
    useAuth.setState({
      user: { id: "user-1", email: "a@b.com", name: "Test User", householdId: "household-1" },
      isAuthenticated: true,
    });
  });

  it("renders the AI Meal Planning section between Store Setup and Household, with correct heading order", async () => {
    renderSettingsPage();

    await screen.findByText(/store setup/i);
    await screen.findByLabelText(/provider/i);
    await screen.findByText(/household$/i);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Settings");

    const h2s = screen.getAllByRole("heading", { level: 2 });
    const h2Text = h2s.map((h) => h.textContent);
    expect(h2Text).toEqual(["Store Setup", "AI Meal Planning", "Household"]);

    // Provider/API key and Prompt template are h3 subgroups under the h2 section —
    // heading order must not skip from h1 to h3.
    const h3s = screen.getAllByRole("heading", { level: 3 });
    expect(h3s.map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Provider & API key", "Prompt template"])
    );
  });

  it("confirms before navigating back while the prompt has unsaved edits", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSettingsPage();

    const promptTextarea = await screen.findByLabelText(/custom instructions/i);
    await user.click(promptTextarea);
    await user.type(promptTextarea, " unsaved change");

    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(confirmSpy).toHaveBeenCalled();
    // Declined the confirm — must still be on the settings page, not navigated away.
    expect(screen.queryByText("Previous screen")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("navigates back without confirming when there are no unsaved prompt edits", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    renderSettingsPage();

    await screen.findByLabelText(/custom instructions/i);
    await user.click(screen.getByRole("button", { name: /go back/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Previous screen")).toBeInTheDocument());

    confirmSpy.mockRestore();
  });
});

describe("SettingsPage — #ai deep link (plan §5.6 error-recovery path)", () => {
  beforeEach(() => {
    useAuth.setState({
      user: { id: "user-1", email: "a@b.com", name: "Test User", householdId: "household-1" },
      isAuthenticated: true,
    });
  });

  it("scrolls to and focuses the AI section when navigated to with a #ai hash", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderSettingsPage("/settings#ai");

    const section = await screen.findByRole("heading", { name: /ai meal planning/i });
    const sectionEl = section.closest("section")!;
    expect(sectionEl).toHaveAttribute("id", "ai");

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy.mock.calls[0]?.[0]).toMatchObject({ block: "start" });
    await waitFor(() => expect(sectionEl).toHaveFocus());

    scrollSpy.mockRestore();
  });

  it("scrolls instantly (no smooth animation) when the user prefers reduced motion", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );

    renderSettingsPage("/settings#ai");

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy.mock.calls[0]?.[0]).toMatchObject({ behavior: "auto" });

    scrollSpy.mockRestore();
    matchMediaSpy.mockRestore();
  });

  it("does not scroll or steal focus when there is no #ai hash", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    renderSettingsPage("/settings");

    await screen.findByRole("heading", { name: /ai meal planning/i });
    expect(scrollSpy).not.toHaveBeenCalled();

    scrollSpy.mockRestore();
  });
});
