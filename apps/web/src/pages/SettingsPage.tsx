import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Search, Sparkles, Store, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type StoreResult } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { AiProviderSection } from "@/components/settings/AiProviderSection";
import { PromptTemplateEditor } from "@/components/settings/PromptTemplateEditor";

export default function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [zip, setZip] = useState("");
  const [searching, setSearching] = useState(false);
  const [storeResults, setStoreResults] = useState<StoreResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [promptDirty, setPromptDirty] = useState(false);

  const aiSectionRef = useRef<HTMLElement | null>(null);

  // React Router doesn't scroll to (or announce) a `#hash` target on its own — the
  // "Go to Settings" link from the meal-plan flow's `invalid_api_key` error banner and
  // `AiSetupPrompt` both deep-link to `/settings#ai`, and without this the user lands
  // silently at the top of a long page. Runs on mount AND whenever the hash changes
  // (e.g. clicking the link again while already on this page).
  useEffect(() => {
    if (location.hash !== "#ai") return;
    const el = aiSectionRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    el.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    // `tabIndex={-1}` on the target makes it programmatically focusable without adding
    // it to the tab order — this is what makes a screen reader actually announce
    // arrival here instead of silently repositioning the visual viewport.
    el.focus();
  }, [location.hash]);

  const { data: household, isLoading } = useQuery({
    queryKey: queryKeys.household.details(),
    queryFn: () => api.getHousehold(),
  });

  const clearStoreMutation = useMutation({
    mutationFn: () =>
      api.updateHouseholdSettings({
        krogerLocationId: null,
        krogerStoreName: null,
        krogerChain: null,
        krogerZipCode: null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
      setStoreResults(null);
      setZip("");
    },
    onError: (err) => {
      setSaveError(
        err instanceof Error ? err.message : "Failed to remove store. Please try again."
      );
    },
  });

  async function handleSearch() {
    if (!/^\d{5}$/.test(zip.trim())) {
      setSearchError("Enter a valid 5-digit zip code");
      return;
    }
    setSearchError(null);
    setSearching(true);
    setStoreResults(null);
    try {
      const results = await api.searchStores(zip.trim());
      setStoreResults(results);
      if (results.length === 0) setSearchError("No stores found near that zip code");
    } catch {
      setSearchError("Store search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectStore(store: StoreResult) {
    setSavingId(store.locationId);
    setSaveError(null);
    try {
      await api.updateHouseholdSettings({
        krogerLocationId: store.locationId,
        krogerStoreName: store.name,
        krogerChain: store.chain,
        krogerZipCode: zip.trim() || household?.krogerZipCode || "",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
      setStoreResults(null);
      setZip("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save store. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  const currentStore = household?.krogerStoreName;
  const currentChain = household?.krogerChain;
  const currentZip = household?.krogerZipCode;

  function handleBack() {
    // Unsaved-changes guard (plan §5.6): the app mounts a plain <BrowserRouter>
    // (src/main.tsx), not a data router, so react-router-dom's useBlocker can't
    // intercept in-app navigation. This back button is the one in-app exit point
    // SettingsPage itself owns, so it's the one place that guard can actually live
    // without touching App.tsx's router setup.
    if (promptDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes to the meal plan prompt. Leave without saving?"
      );
      if (!confirmed) return;
    }
    navigate(-1);
  }

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Store Setup section */}
        <section className="bg-card rounded-2xl border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-base">Store Setup</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Set your preferred grocery store to get location-specific prices and stock levels when
            searching for products.
          </p>

          {isLoading ? (
            <div className="h-12 bg-muted animate-pulse rounded-xl" />
          ) : currentStore ? (
            /* Current store display */
            <div className="space-y-3">
              <div className="flex items-start gap-3 bg-muted/50 rounded-xl p-4">
                <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm leading-snug">{currentStore}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {currentChain}
                    {currentZip ? ` · ${currentZip}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => clearStoreMutation.mutate()}
                  disabled={clearStoreMutation.isPending}
                  aria-label="Remove store"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {/* Allow changing store */}
              {storeResults === null && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStoreResults([])}
                  className="w-full"
                >
                  Change store
                </Button>
              )}
            </div>
          ) : null}

          {/* Zip search — shown when no store set OR after clicking Change */}
          {(!currentStore || storeResults !== null) && (
            <div className="space-y-3">
              {storeResults !== null && currentStore && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStoreResults(null)}
                  className="text-muted-foreground -mt-1"
                >
                  Cancel
                </Button>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Zip code (e.g. 28607)"
                  value={zip}
                  onChange={(e) => {
                    setZip(e.target.value);
                    setSearchError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSearch();
                  }}
                  maxLength={5}
                  inputMode="numeric"
                  className="flex-1"
                />
                <Button onClick={() => void handleSearch()} disabled={searching}>
                  <Search className="h-4 w-4 mr-2" />
                  {searching ? "Searching…" : "Find stores"}
                </Button>
              </div>

              {searchError && <p className="text-sm text-destructive">{searchError}</p>}
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}

              {/* Store results list */}
              {storeResults && storeResults.length > 0 && (
                <div className="divide-y rounded-xl border overflow-hidden">
                  {storeResults.map((store) => (
                    <button
                      key={store.locationId}
                      type="button"
                      onClick={() => void handleSelectStore(store)}
                      disabled={savingId !== null}
                      className={[
                        "w-full text-left px-4 py-3 flex items-center gap-3 transition-colors",
                        savingId === store.locationId ? "bg-primary/10" : "hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug truncate">{store.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {store.address}, {store.city}, {store.state} · {store.chain}
                        </p>
                      </div>
                      {savingId === store.locationId ? (
                        <span className="text-xs text-muted-foreground shrink-0">Saving…</span>
                      ) : (
                        household?.krogerLocationId === store.locationId && (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        )
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* AI Meal Planning section (plan §5.6) — provider/model/key, household-level
            meal preferences, and the prompt template. Two <h3> subgroups keep heading
            order intact (h1 page title → h2 section → h3 subgroup). */}
        <section
          id="ai"
          ref={aiSectionRef}
          tabIndex={-1}
          aria-labelledby="ai-meal-planning-heading"
          className="bg-card rounded-2xl border p-5 space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 id="ai-meal-planning-heading" className="font-semibold text-base">
              AI Meal Planning
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Bring your own API key to generate weekly meal plans from your pantry.
          </p>

          <AiProviderSection />

          <div className="border-t pt-4">
            <PromptTemplateEditor onDirtyChange={setPromptDirty} />
          </div>
        </section>

        {/* Household section */}
        {household && (
          <section className="bg-card rounded-2xl border p-5 space-y-4">
            <h2 className="font-semibold text-base">Household</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{household.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Invite code</p>
              </div>
              <span className="font-mono text-sm font-semibold tracking-widest bg-muted px-3 py-1.5 rounded-lg">
                {household.inviteCode}
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
