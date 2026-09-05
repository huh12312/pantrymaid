import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { useAuth } from "@/lib/auth";
import JoinHouseholdPage from "@/pages/JoinHouseholdPage";

const API_BASE = "http://localhost:3000";

function renderJoinPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/join"]}>
        <ThemeProvider>
          <Routes>
            <Route path="/join" element={<JoinHouseholdPage />} />
            <Route path="/inventory" element={<div>Inventory Screen</div>} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("JoinHouseholdPage — destructive leave-and-join flow", () => {
  beforeEach(() => {
    localStorage.clear();
    // Authenticated user who is already in a household → the leave-confirm path.
    useAuth.setState({
      user: { id: "user-1", email: "a@b.com", name: "Test User", householdId: "household-1" },
      isAuthenticated: true,
    });
  });

  it("requires explicit confirmation before leaving the current household, then joins", async () => {
    const user = userEvent.setup();
    let leaveAndJoinCalled = false;
    server.use(
      http.get(`${API_BASE}/api/households/validate-invite`, () =>
        HttpResponse.json({ valid: true, householdName: "Target House" })
      ),
      http.post(`${API_BASE}/api/households/leave-and-join`, () => {
        leaveAndJoinCalled = true;
        return HttpResponse.json({
          success: true,
          data: { householdId: "household-2", householdName: "Target House" },
        });
      })
    );

    renderJoinPage();

    await user.type(screen.getByLabelText(/invite code/i), "TARGET12");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // The destructive confirmation must appear with an irreversible-data warning,
    // and must NOT have switched households yet.
    await waitFor(() => expect(screen.getByText(/leave current household\?/i)).toBeInTheDocument());
    expect(screen.getByText(/permanently delete all of your pantry data/i)).toBeInTheDocument();
    expect(leaveAndJoinCalled).toBe(false);

    await user.click(screen.getByRole("button", { name: /leave & join target house/i }));

    // Only after explicit confirmation does it call the destructive endpoint and navigate.
    await waitFor(() => expect(screen.getByText("Inventory Screen")).toBeInTheDocument());
    expect(leaveAndJoinCalled).toBe(true);
  });

  it("shows an error and does not advance when the invite code is invalid", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE}/api/households/validate-invite`, () =>
        HttpResponse.json({ valid: false })
      )
    );

    renderJoinPage();

    await user.type(screen.getByLabelText(/invite code/i), "BADCODE1");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(screen.getByText(/invalid invite code/i)).toBeInTheDocument());
    // Still on step 1 — no confirmation screen.
    expect(screen.queryByText(/leave current household\?/i)).not.toBeInTheDocument();
  });
});
