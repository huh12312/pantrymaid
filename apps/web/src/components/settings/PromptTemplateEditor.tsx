import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type MealPlanPrompt } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// No dedicated query key exists in lib/queryKeys.ts for meal plan prompts yet (that
// file is out of scope for this task — another agent owns it), so this local key is
// scoped to this component only. It never collides with anything under
// queryKeys.mealPlan.* or queryKeys.aiSettings.*.
const MEAL_PLAN_PROMPTS_QUERY_KEY = ["settings", "mealPlanPrompts"] as const;

const PROMPT_MAX_LENGTH = 8000;

const VARIABLES: { token: string; description: string }[] = [
  { token: "{{PANTRY}}", description: "The household's current pantry items." },
  { token: "{{EXPIRING}}", description: "Items expiring soon or already opened." },
  { token: "{{DAYS}}", description: "Number of days the plan covers." },
  { token: "{{SERVINGS}}", description: "Default servings per meal." },
  { token: "{{HOUSEHOLD}}", description: "Household name, for a personal touch." },
];

const KNOWN_VARIABLE_NAMES = new Set(VARIABLES.map((v) => v.token.replace(/[{}]/g, "")));

// The shipped default the "Reset to default" action restores. This is a client-side
// starting point, not a server-fetched value — there's no "the base template" endpoint,
// only per-household `meal_plan_prompts` rows (plan §3, §4.4).
const DEFAULT_PROMPT_BODY = `Plan meals that are quick to prepare on weeknights and lean on what's
already in the pantry when possible ({{PANTRY}}).

Favor simple, familiar dishes for a household of {{SERVINGS}}. Use up
{{EXPIRING}} where it makes sense.`;

function findUnknownVariableTokens(body: string): string[] {
  const matches = body.match(/\{\{[A-Z_]+\}\}/g) ?? [];
  const unknown = new Set<string>();
  for (const token of matches) {
    const name = token.replace(/[{}]/g, "");
    if (!KNOWN_VARIABLE_NAMES.has(name)) unknown.add(token);
  }
  return Array.from(unknown);
}

export interface PromptTemplateEditorProps {
  /** Reports whether the prompt body has unsaved edits, for a navigation guard one
   * level up (SettingsPage's own "back" affordance) — see the `beforeunload` guard
   * below for the tab-close/reload half of this. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function PromptTemplateEditor({ onDirtyChange }: PromptTemplateEditorProps = {}) {
  const queryClient = useQueryClient();
  const currentUser = useAuth((s) => s.user);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: prompts, isLoading } = useQuery({
    queryKey: MEAL_PLAN_PROMPTS_QUERY_KEY,
    queryFn: () => api.listMealPlanPrompts(),
  });

  const activePrompt: MealPlanPrompt | null =
    prompts?.find((p) => p.isDefault) ?? prompts?.[0] ?? null;

  const [body, setBody] = useState("");
  const seededPromptId = useRef<string | null | undefined>(undefined);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Seed once per distinct prompt identity (including the "no prompt exists yet, so
  // start from the default body" case). Guarded so a background refetch after Save
  // doesn't clobber in-progress typing.
  useEffect(() => {
    if (isLoading) return;
    const id = activePrompt?.id ?? null;
    if (seededPromptId.current === id) return;
    seededPromptId.current = id;
    setBody(activePrompt?.body ?? DEFAULT_PROMPT_BODY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, activePrompt?.id]);

  const isDirty = !isLoading && body !== (activePrompt?.body ?? DEFAULT_PROMPT_BODY);

  // Unsaved-changes guard for tab close / reload (plan §5.6). The app mounts a plain
  // <BrowserRouter> (src/main.tsx), not a data router, so react-router-dom's
  // useBlocker (which requires a data router) can't intercept in-app navigation here —
  // see the SettingsPage-level guard on the back button for that half of the coverage.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    // Only fire on isDirty transitions — onDirtyChange identity churning every render
    // (an inline arrow from the parent) must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  const saveMutation = useMutation({
    mutationFn: (nextBody: string) =>
      activePrompt
        ? api.updateMealPlanPrompt(activePrompt.id, { body: nextBody })
        : api.createMealPlanPrompt({ name: "Default", body: nextBody, isDefault: true }),
    onSuccess: (saved) => {
      queryClient.setQueryData<MealPlanPrompt[]>(MEAL_PLAN_PROMPTS_QUERY_KEY, (prev) => {
        if (!prev || prev.length === 0) return [saved];
        return prev.map((p) => (p.id === saved.id ? saved : p));
      });
      seededPromptId.current = saved.id;
      setSaveError(null);
      setSavedNotice(true);
    },
    onError: (err) => {
      setSavedNotice(false);
      setSaveError(err instanceof Error ? err.message : "Failed to save the prompt template.");
    },
  });

  if (isLoading) {
    return <div className="h-64 bg-muted animate-pulse rounded-xl" />;
  }

  const unknownTokens = findUnknownVariableTokens(body);
  const trimmedLength = body.length;
  const overLimit = trimmedLength > PROMPT_MAX_LENGTH;
  const isEmpty = body.trim().length === 0;

  function insertVariable(token: string) {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    // Restore focus and caret position after the inserted token on the next tick,
    // once React has re-rendered the textarea with the new value.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function handleSave() {
    setSavedNotice(false);
    if (isEmpty) {
      setValidationError("Prompt cannot be empty.");
      return;
    }
    if (overLimit) {
      setValidationError(
        `Prompt is too long (${trimmedLength} of ${PROMPT_MAX_LENGTH} characters).`
      );
      return;
    }
    setValidationError(null);
    saveMutation.mutate(body);
  }

  function handleResetConfirm() {
    setBody(DEFAULT_PROMPT_BODY);
    setValidationError(null);
    setResetDialogOpen(false);
  }

  const lastEditedBy = activePrompt?.updatedBy ?? null;
  const lastEditedAt = activePrompt?.updatedAt ?? null;
  const lastEditedByLabel =
    lastEditedBy && currentUser && lastEditedBy === currentUser.id ? "you" : lastEditedBy;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">Prompt template</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setResetDialogOpen(true)}
          className="text-muted-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset to default
        </Button>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Available variables</summary>
        <dl className="mt-2 space-y-1.5">
          {VARIABLES.map((v) => (
            <div key={v.token} className="flex flex-wrap items-baseline gap-2">
              <dt>
                <button
                  type="button"
                  onClick={() => insertVariable(v.token)}
                  className="font-mono text-xs rounded-full border px-2.5 py-1 hover:bg-muted"
                >
                  {v.token}
                </button>
              </dt>
              <dd className="text-xs text-muted-foreground">{v.description}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="space-y-1.5">
        <Label htmlFor="meal-plan-prompt-body">Custom instructions</Label>
        <Textarea
          id="meal-plan-prompt-body"
          ref={textareaRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setValidationError(null);
          }}
          className="font-mono text-sm min-h-64"
          aria-describedby={
            [
              validationError ? "prompt-validation-error" : null,
              unknownTokens.length > 0 ? "prompt-unknown-tokens" : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        <p className="text-xs text-muted-foreground">
          {trimmedLength.toLocaleString()} / {PROMPT_MAX_LENGTH.toLocaleString()} characters
        </p>
        {lastEditedBy && lastEditedAt && (
          <p className="text-xs text-muted-foreground">
            Last edited by {lastEditedByLabel} on {new Date(lastEditedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {unknownTokens.length > 0 && (
        <p id="prompt-unknown-tokens" role="status" className="text-sm text-warning">
          Unrecognized variable{unknownTokens.length > 1 ? "s" : ""}: {unknownTokens.join(", ")}.
          This will still save, but won&apos;t be substituted at generation time.
        </p>
      )}

      {validationError && (
        <p id="prompt-validation-error" role="alert" className="text-sm text-destructive">
          {validationError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save prompt"}
        </Button>
        {savedNotice && (
          <p role="status" className="text-sm text-primary">
            Saved.
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}
      </div>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset prompt to default?</DialogTitle>
            <DialogDescription>
              This replaces your custom instructions with the default template. Nothing is saved
              until you click Save prompt afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetConfirm}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
