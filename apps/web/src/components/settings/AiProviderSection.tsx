import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiKeyField } from "./ApiKeyField";
import {
  api,
  type LLMProvider,
  type LlmTestError,
  type LlmTestResult,
  type UpdateLlmSettingsInput,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

const PROVIDERS: { value: LLMProvider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "anthropic", label: "Anthropic" },
];

// Mirrors packages/shared/src/schemas/index.ts `llmModelIdSchema`'s regex exactly.
// Duplicated locally (rather than importing the zod schema) so rejection of a
// structurally-invalid model id is instant and doesn't depend on a round trip. Real
// "does this model exist" validation is deliberately NOT done here — that's deferred
// to Test Connection so the provider's own error surfaces verbatim (plan §5.6).
const MODEL_ID_PATTERN = /^[a-zA-Z0-9._/-]{1,100}$/;

const TEST_ERROR_MESSAGES: Record<LlmTestError, string> = {
  invalid_key: "That API key was rejected by the provider. Double-check it and try again.",
  rate_limited: "The provider is rate-limiting this key right now. Wait a moment and try again.",
  provider_unavailable: "The provider is unavailable right now. Try again in a moment.",
  timeout: "The request timed out waiting for a response. Try again.",
};

interface TagListInputProps {
  id: string;
  label: string;
  helperText: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}

/**
 * A minimal tag-list editor for the allergies / dietary-restrictions arrays
 * (`llmSettingsSchema.allergies`/`dietaryRestrictions`, both `string[]`). Plan Q4:
 * these are first-class fields precisely so a prompt edit can't silently delete them,
 * so they're edited here, not only inside the prompt body text.
 */
function TagListInput({ id, label, helperText, values, onChange, placeholder }: TagListInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-xs text-muted-foreground">{helperText}</p>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={commit}
          aria-label={`Add ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2 pt-1">
          {values.map((v) => (
            <li key={v}>
              <Badge variant="secondary" className="gap-1.5 pr-1">
                {v}
                <button
                  type="button"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="relative inline-flex h-4 w-4 items-center justify-center rounded-full after:absolute after:-inset-3 after:content-[''] hover:bg-foreground/10"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiProviderSection() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.aiSettings.details(),
    queryFn: () => api.getLlmSettings(),
  });

  // "" (never null/undefined) so the Radix Select below is controlled from the very
  // first render — passing `undefined` initially and a real value once the seed effect
  // runs makes Select flip from uncontrolled to controlled, which is a real bug in this
  // library pairing (not just a benign React warning): it visibly resets the trigger to
  // its placeholder. "" is a controlled "nothing selected" the whole time.
  const [provider, setProvider] = useState<LLMProvider | "">("");
  const [model, setModel] = useState("");
  // Unlike `model` above, this is NOT seeded from `envDefaults` — it stays exactly
  // what the household saved (or "" if never configured). The fallback is communicated
  // instead via helper text/placeholder referencing `envDefaults.visionModel`, so an
  // empty box reads as "intentionally using the default" rather than "unconfigured".
  const [visionModel, setVisionModel] = useState("");
  // Tracks whether the user has actually edited this field since it was seeded, which
  // is what decides the shape of the PUT body (mirrors the `apiKey` precedent in
  // `lib/api.ts`): untouched -> omit `visionModel` entirely (no change); touched and
  // emptied -> send `visionModel: null` (explicit clear back to env/default); touched
  // and non-empty -> send the trimmed string. Only a real onChange (not the seed
  // effect below) sets this to true.
  const [visionModelTouched, setVisionModelTouched] = useState(false);
  const [defaultServings, setDefaultServings] = useState(2);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const seeded = useRef(false);

  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [providerChangeWarning, setProviderChangeWarning] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [visionModelError, setVisionModelError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [testRequestError, setTestRequestError] = useState<string | null>(null);

  // Seed local form state from the fetched settings exactly once — re-running this on
  // every refetch (e.g. after Save invalidates the query) would stomp in-progress edits.
  //
  // A household that has never saved its own provider/model (both null) falls back to
  // the operator's container-wide `envDefaults` — pre-filling the form with what
  // generation would actually use, rather than a blank Select and an empty Model
  // field (plan §5.6 problem 2). Once the household saves its own values, THOSE win
  // here unconditionally; envDefaults is purely a first-run seed.
  //
  // `envDefaults.provider`/`model` are ALSO null when the operator's LLM_PROVIDER is
  // set to something meal planning doesn't support (groq/ollama/a typo) — in that case
  // there is nothing sane to seed with, so the form stays blank on purpose and
  // `envDefaults.unsupportedProvider` (surfaced below, near the Provider select) tells
  // the household why, instead of an unexplained empty form that looks identical to
  // "operator never configured anything".
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setProvider(data.provider ?? data.envDefaults?.provider ?? "");
    setModel(data.model ?? data.envDefaults?.model ?? "");
    setVisionModel(data.visionModel ?? "");
    setDefaultServings(data.defaultServings);
    setAllergies(data.allergies);
    setDietaryRestrictions(data.dietaryRestrictions);
  }, [data]);

  // Live model suggestions for whichever provider is currently selected (plan §5.6) —
  // replaces what used to be a hardcoded, rotting list. Suggestions ONLY: the model
  // field stays free text regardless of what this returns, including on error — a
  // failed/empty fetch degrades silently to plain free-text entry, never a blocking
  // error state (see `modelsQuery.isError` handling below, which renders nothing).
  const modelsQuery = useQuery({
    queryKey: queryKeys.aiSettings.models(provider || "none"),
    queryFn: () => api.getLlmModels(provider as LLMProvider),
    enabled: provider !== "",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const modelSuggestions = modelsQuery.data?.models ?? [];
  const showModelStatus = Boolean(
    provider && (modelsQuery.isLoading || modelSuggestions.length === 0)
  );

  // What receipt OCR actually falls back to when the household hasn't set its own
  // `visionModel` — surfaced as helper/placeholder text so the vision field reads as
  // "intentionally defaulted", not "broken/unconfigured" (unlike `model` above, this
  // value is never written INTO the input itself).
  const visionModelFallback = data?.envDefaults?.visionModel ?? null;

  // Honesty over a silent fallback: when this household has never chosen its own
  // provider AND the operator's container-wide LLM_PROVIDER is set to something meal
  // planning doesn't support (groq/ollama/a typo), envDefaults.provider/model come
  // back null with nothing to seed the form with. Rather than render an unexplained
  // blank Select that looks identical to "operator configured nothing at all",
  // surface exactly what's misconfigured — the operator's raw value — so a household
  // isn't left guessing why the form didn't pre-fill.
  const envUnsupportedProvider =
    data && !data.provider ? (data.envDefaults?.unsupportedProvider ?? null) : null;

  const saveMutation = useMutation({
    mutationFn: (input: UpdateLlmSettingsInput) => api.updateLlmSettings(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.aiSettings.details(), updated);
      setIsReplacingKey(false);
      setApiKeyDraft("");
      setProviderChangeWarning(null);
      setSaveError(null);
      setSavedNotice(true);
    },
    onError: (err) => {
      setSavedNotice(false);
      setSaveError(err instanceof Error ? err.message : "Failed to save AI settings.");
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      api.testLlmSettings({
        provider: provider || undefined,
        model: model.trim() || undefined,
        ...(isReplacingKey && apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      }),
    onMutate: () => {
      setTestResult(null);
      setTestRequestError(null);
    },
    onSuccess: (result) => setTestResult(result),
    onError: (err) => {
      setTestRequestError(err instanceof Error ? err.message : "Test connection failed.");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-11 bg-muted animate-pulse rounded-xl" />
        <div className="h-11 bg-muted animate-pulse rounded-xl" />
        <div className="h-12 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  const keyConfigured = data?.keyConfigured ?? false;
  const canTest =
    provider !== "" &&
    MODEL_ID_PATTERN.test(model.trim()) &&
    (keyConfigured || (isReplacingKey && apiKeyDraft.trim().length > 0));

  function handleProviderChange(next: string) {
    // Radix Select's hidden native <select> (rendered for form/autofill integration
    // whenever the trigger sits inside a <form>, which ours does) mirrors the
    // controlled `value` via a synthetic native "change" event fired from an effect.
    // When that mirroring effect runs before the corresponding native <option> has
    // finished registering — observed here specifically on the FIRST controlled
    // value ever set (i.e. the moment this form's seed-from-query-data effect moves
    // `provider` from "" to a real value on load), the browser/jsdom silently resets
    // the hidden select to "" and Radix reports that back through onValueChange. "" is
    // never a value a real user selection can produce (no SelectItem has value=""),
    // so it's safe and correct to treat it as this internal artifact and ignore it.
    if (!next) return;
    const nextProvider = next as LLMProvider;
    setProvider(nextProvider);
    setModel("");
    setModelError(null);
    setTestResult(null);
    setTestRequestError(null);
    if (keyConfigured || apiKeyDraft.trim()) {
      setProviderChangeWarning(
        "Your stored key was saved for a different provider. Test the connection or replace the key before saving."
      );
    } else {
      setProviderChangeWarning(null);
    }
  }

  function handleModelChange(next: string) {
    setModel(next);
    setModelError(null);
    setTestResult(null);
  }

  function handleVisionModelChange(next: string) {
    setVisionModel(next);
    setVisionModelTouched(true);
    setVisionModelError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSavedNotice(false);
    if (!provider) {
      setSaveError("Choose a provider before saving.");
      return;
    }
    const trimmedModel = model.trim();
    if (!MODEL_ID_PATTERN.test(trimmedModel)) {
      setModelError("Model must contain only letters, numbers, and . _ / -");
      return;
    }
    setModelError(null);

    // Empty is a valid, meaningful value here (it means "use the env/default vision
    // model"), so — unlike the chat model above — the pattern is only enforced when
    // the user actually typed something.
    const trimmedVisionModel = visionModel.trim();
    if (trimmedVisionModel && !MODEL_ID_PATTERN.test(trimmedVisionModel)) {
      setVisionModelError("Model must contain only letters, numbers, and . _ / -");
      return;
    }
    setVisionModelError(null);

    // CRITICAL (plan §6.2): submitting without touching the key field must send no
    // `apiKey` at all — never re-PUT the masked placeholder as if it were real. The
    // masked display never even reaches component state, so this is structural, not
    // just a runtime check: apiKey is only ever included when the user actually typed
    // a replacement.
    const input: UpdateLlmSettingsInput = {
      provider,
      model: trimmedModel,
      defaultServings,
      allergies,
      dietaryRestrictions,
      ...(isReplacingKey && apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      // Same null-vs-undefined precedent as `apiKey`: untouched -> omitted entirely (no
      // change); touched and emptied -> explicit `null` (clear back to env/default);
      // touched and non-empty -> the trimmed model id.
      ...(visionModelTouched ? { visionModel: trimmedVisionModel || null } : {}),
    };
    saveMutation.mutate(input);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="font-semibold text-sm">Provider &amp; API key</h3>

      {envUnsupportedProvider && (
        <p role="status" className="text-sm text-muted-foreground">
          This container&apos;s LLM_PROVIDER is set to &quot;{envUnsupportedProvider}&quot;, which
          isn&apos;t supported for meal planning (only OpenAI, Anthropic, and OpenRouter are — that
          setting is still fine for receipt scanning). Choose a provider below to enable meal
          planning for this household.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="llm-provider">Provider</Label>
        <Select value={provider} onValueChange={handleProviderChange}>
          <SelectTrigger id="llm-provider">
            <SelectValue placeholder="Choose a provider" />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {providerChangeWarning && (
        <p role="status" className="text-sm text-warning">
          {providerChangeWarning}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="llm-model">Model</Label>
        <Input
          id="llm-model"
          list="llm-model-suggestions"
          value={model}
          onChange={(e) => handleModelChange(e.target.value)}
          placeholder="e.g. gpt-4o-mini"
          aria-describedby={
            [modelError ? "llm-model-error" : null, showModelStatus ? "llm-model-status" : null]
              .filter((id): id is string => id !== null)
              .join(" ") || undefined
          }
        />
        {/* Suggestions ONLY — never a locked enum. A model id missing from this list
            (live-fetched or not, loaded or not) is always accepted by the input above;
            nothing here can block free-text entry (plan §5.6). */}
        <datalist id="llm-model-suggestions">
          {modelSuggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {provider && modelsQuery.isLoading && (
          <p id="llm-model-status" className="text-xs text-muted-foreground">
            Loading model suggestions…
          </p>
        )}
        {provider && !modelsQuery.isLoading && modelSuggestions.length === 0 && (
          <p id="llm-model-status" className="text-xs text-muted-foreground">
            No live suggestions available right now — you can still type any model id.
          </p>
        )}
        {modelSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {modelSuggestions.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleModelChange(m)}
                className="text-xs rounded-full border px-2.5 py-1 hover:bg-muted"
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {modelError && (
          <p id="llm-model-error" role="alert" className="text-sm text-destructive">
            {modelError}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="llm-vision-model">Vision model (receipt OCR)</Label>
        <Input
          id="llm-vision-model"
          list="llm-vision-model-suggestions"
          value={visionModel}
          onChange={(e) => handleVisionModelChange(e.target.value)}
          placeholder={visionModelFallback ? `Defaults to ${visionModelFallback}` : "e.g. gpt-4o"}
          aria-describedby={
            [
              "llm-vision-model-purpose",
              "llm-vision-model-fallback",
              visionModelError ? "llm-vision-model-error" : null,
            ]
              .filter((id): id is string => id !== null)
              .join(" ") || undefined
          }
        />
        {/* Same free-text-always-wins contract as the chat model above (plan §5.6): a
            vision-capable model missing from this list is never blocked, and the list
            is the SAME live catalogue query as the chat model — no second network call
            or query key for this field. */}
        <datalist id="llm-vision-model-suggestions">
          {modelSuggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p id="llm-vision-model-purpose" className="text-xs text-muted-foreground">
          Reads receipt photos during OCR, so it must be vision-capable — separate from the chat
          model above, which is used for meal planning and item suggestions.
        </p>
        <p id="llm-vision-model-fallback" className="text-xs text-muted-foreground">
          {visionModelFallback
            ? `Leave blank to use the default: ${visionModelFallback}.`
            : "Leave blank to use this provider's default vision model."}
        </p>
        {modelSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {modelSuggestions.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleVisionModelChange(m)}
                aria-label={`Use ${m} as vision model`}
                className="text-xs rounded-full border px-2.5 py-1 hover:bg-muted"
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {visionModelError && (
          <p id="llm-vision-model-error" role="alert" className="text-sm text-destructive">
            {visionModelError}
          </p>
        )}
      </div>

      <ApiKeyField
        keyConfigured={keyConfigured}
        keyLast4={data?.keyLast4 ?? null}
        isReplacing={isReplacingKey}
        value={apiKeyDraft}
        onValueChange={setApiKeyDraft}
        onStartReplace={() => setIsReplacingKey(true)}
        onCancelReplace={() => {
          setIsReplacingKey(false);
          setApiKeyDraft("");
        }}
        disabled={saveMutation.isPending}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canTest || testMutation.isPending}
          onClick={() => testMutation.mutate()}
        >
          {testMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Testing…
            </>
          ) : (
            "Test connection"
          )}
        </Button>
        {testResult && (
          <p
            role="status"
            className={testResult.ok ? "text-sm text-primary" : "text-sm text-destructive"}
          >
            {testResult.ok
              ? `Connected successfully (${testResult.latencyMs}ms).`
              : (testResult.error && TEST_ERROR_MESSAGES[testResult.error]) ||
                "The test connection failed."}
          </p>
        )}
        {testRequestError && (
          <p role="alert" className="text-sm text-destructive">
            {testRequestError}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="default-servings">Default servings</Label>
        <Input
          id="default-servings"
          type="number"
          min={1}
          max={20}
          value={defaultServings}
          onChange={(e) => setDefaultServings(Number(e.target.value) || 1)}
          className="max-w-[8rem]"
        />
      </div>

      <TagListInput
        id="llm-allergies"
        label="Allergies"
        helperText="Never removed by a prompt edit — always enforced as a hard constraint."
        values={allergies}
        onChange={setAllergies}
        placeholder="e.g. peanuts"
      />

      <TagListInput
        id="llm-dietary-restrictions"
        label="Dietary restrictions"
        helperText="e.g. vegetarian, gluten-free — also enforced as a hard constraint."
        values={dietaryRestrictions}
        onChange={setDietaryRestrictions}
        placeholder="e.g. vegetarian"
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            "Save AI settings"
          )}
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
    </form>
  );
}
