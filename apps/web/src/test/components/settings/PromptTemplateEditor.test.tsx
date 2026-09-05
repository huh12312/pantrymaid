import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";
import { PromptTemplateEditor } from "@/components/settings/PromptTemplateEditor";
import { useAuth } from "@/lib/auth";

const API_BASE = "http://localhost:3000";

function renderEditor(onDirtyChange?: (dirty: boolean) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PromptTemplateEditor onDirtyChange={onDirtyChange} />
    </QueryClientProvider>
  );
}

async function waitForLoaded() {
  await screen.findByLabelText(/custom instructions/i);
}

describe("PromptTemplateEditor", () => {
  beforeEach(() => {
    useAuth.setState({
      user: { id: "user-1", email: "a@b.com", name: "Test User", householdId: "household-1" },
      isAuthenticated: true,
    });
  });

  it("loads the default prompt's body and shows 'last edited by' attribution", async () => {
    renderEditor();
    await waitForLoaded();
    const textarea = screen.getByLabelText(/custom instructions/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain("{{PANTRY}}");
    expect(screen.getByText(/last edited by/i)).toBeInTheDocument();
  });

  it("shows 'you' when the current user is the last editor", async () => {
    renderEditor();
    await waitForLoaded();
    // The default mock prompt's updatedBy is "user-1", matching the signed-in user above.
    expect(screen.getByText(/last edited by you on/i)).toBeInTheDocument();
  });

  it("rejects a prompt over 8000 characters without saving", async () => {
    const user = userEvent.setup();
    let saveCalled = false;
    server.use(
      http.patch(`${API_BASE}/api/meal-plans/prompts/:id`, () => {
        saveCalled = true;
        return HttpResponse.json(
          { success: false, error: "should not be called" },
          { status: 400 }
        );
      })
    );
    renderEditor();
    await waitForLoaded();
    const textarea = screen.getByLabelText(/custom instructions/i) as HTMLTextAreaElement;
    // Set the value directly rather than typing 8001 characters one keystroke at a
    // time (which would make this test extremely slow under userEvent).
    await user.click(textarea);
    await user.paste("a".repeat(8001));

    await user.click(screen.getByRole("button", { name: /save prompt/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too long/i);
    expect(saveCalled).toBe(false);
  });

  it("warns on an unknown {{FOO}} variable but still allows saving", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${API_BASE}/api/meal-plans/prompts/:id`, async ({ params, request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            id: params.id,
            householdId: "household-1",
            name: "Default",
            body: capturedBody.body,
            isDefault: true,
            updatedBy: "user-1",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      })
    );
    renderEditor();
    await waitForLoaded();
    const textarea = screen.getByLabelText(/custom instructions/i) as HTMLTextAreaElement;
    await user.click(textarea);
    await user.paste(" Use {{FOO}} please.");

    expect(await screen.findByText(/unrecognized variable/i)).toHaveTextContent("{{FOO}}");
    // The warning is informational (role=status), not blocking (role=alert).
    expect(screen.getByText(/unrecognized variable/i)).toHaveAttribute("role", "status");

    await user.click(screen.getByRole("button", { name: /save prompt/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect((capturedBody as Record<string, unknown>).body as string).toContain("{{FOO}}");
  });

  it("inserting a variable chip adds the token at the current caret position", async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitForLoaded();
    const textarea = screen.getByLabelText(/custom instructions/i) as HTMLTextAreaElement;
    const before = textarea.value;

    await user.click(screen.getByText(/available variables/i));
    await user.click(screen.getByRole("button", { name: "{{SERVINGS}}" }));

    expect(textarea.value).toBe(before + "{{SERVINGS}}");
  });

  it("Reset to default requires confirmation before replacing the body", async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitForLoaded();
    const textarea = screen.getByLabelText(/custom instructions/i) as HTMLTextAreaElement;
    const original = textarea.value;

    await user.click(textarea);
    await user.type(textarea, " extra edits");
    expect(textarea.value).not.toBe(original);

    await user.click(screen.getByRole("button", { name: /reset to default/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/reset prompt to default/i);

    // Cancel first — must NOT reset.
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(textarea.value).not.toBe(original);
    expect(textarea.value).toContain("extra edits");

    // Now confirm.
    await user.click(screen.getByRole("button", { name: /reset to default/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(textarea.value).not.toContain("extra edits");
  });

  it("reports dirty state to the parent as the body is edited and after save", async () => {
    const user = userEvent.setup();
    const dirtyStates: boolean[] = [];
    server.use(
      http.patch(`${API_BASE}/api/meal-plans/prompts/:id`, async ({ params, request }) => {
        const body = (await request.json()) as { body?: string };
        return HttpResponse.json({
          success: true,
          data: {
            id: params.id,
            householdId: "household-1",
            name: "Default",
            body: body.body,
            isDefault: true,
            updatedBy: "user-1",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      })
    );
    renderEditor((dirty) => dirtyStates.push(dirty));
    await waitForLoaded();
    expect(dirtyStates.at(-1)).toBe(false);

    const textarea = screen.getByLabelText(/custom instructions/i);
    await user.click(textarea);
    await user.type(textarea, " x");
    expect(dirtyStates.at(-1)).toBe(true);

    await user.click(screen.getByRole("button", { name: /save prompt/i }));
    await waitFor(() => expect(dirtyStates.at(-1)).toBe(false));
  });
});
