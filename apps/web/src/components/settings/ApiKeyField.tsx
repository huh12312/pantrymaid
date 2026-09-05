import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The API key row (plan §5.6, §6.2). Write-only, always: the server never returns the
 * raw key, only `keyConfigured`/`keyLast4`, and this component never receives — let
 * alone renders — the full key. When a key is already configured it shows a masked
 * placeholder (`••••{last4}`, matching the exact format the web test-strategy section
 * §8 asserts on) plus a "Replace" action; only Replace reveals a real input, and that
 * input is a plain `type="password"` with no reveal toggle — this is a stored secret,
 * not a login field being typed blind, so there's nothing legitimate to reveal after
 * the fact.
 *
 * No "Remove" action: `updateLlmSettingsSchema.apiKey` is `optional()` but not
 * `nullable()`, and `PUT /api/settings/llm` (server/src/routes/settings.ts) keeps the
 * existing ciphertext whenever `apiKey` is omitted from the request — there is no wire
 * shape that means "clear the stored key". Rendering a "Remove" button that can't
 * actually clear anything server-side would be a UI lie about a security-critical
 * control, so it's intentionally left out here (see the SETTINGS_UI_REPORT note this
 * task was built against for the full rationale).
 */
export interface ApiKeyFieldProps {
  /** Whether the household currently has a stored key (server-reported, never the key itself). */
  keyConfigured: boolean;
  /** Last 4 characters of the stored key, for the masked display only. */
  keyLast4: string | null;
  /** Whether the Replace input is currently shown. */
  isReplacing: boolean;
  /** The in-progress typed replacement value. Only meaningful while `isReplacing`. */
  value: string;
  onValueChange: (value: string) => void;
  onStartReplace: () => void;
  onCancelReplace: () => void;
  disabled?: boolean;
  id?: string;
}

export function ApiKeyField({
  keyConfigured,
  keyLast4,
  isReplacing,
  value,
  onValueChange,
  onStartReplace,
  onCancelReplace,
  disabled = false,
  id = "llm-api-key",
}: ApiKeyFieldProps) {
  if (isReplacing) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{keyConfigured ? "New API key" : "API key"}</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="sk-..."
            disabled={disabled}
            className="flex-1"
          />
          {keyConfigured && (
            <Button type="button" variant="ghost" onClick={onCancelReplace} disabled={disabled}>
              Cancel
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Stored encrypted server-side. Never displayed again after saving.
        </p>
      </div>
    );
  }

  if (keyConfigured) {
    return (
      <div className="space-y-1.5">
        <span className="text-sm font-medium">API key</span>
        <div className="flex items-center justify-between gap-3 bg-muted/50 rounded-xl px-4 py-3">
          <span className="font-mono text-sm tracking-wider">
            {"••••"}
            {keyLast4 ?? "????"}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onStartReplace}>
            Replace
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">API key</span>
      <div className="flex items-center justify-between gap-3 bg-muted/50 rounded-xl px-4 py-3">
        <span className="text-sm text-muted-foreground">No API key configured yet</span>
        <Button type="button" variant="outline" size="sm" onClick={onStartReplace}>
          Add API key
        </Button>
      </div>
    </div>
  );
}
