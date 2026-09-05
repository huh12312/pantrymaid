import { _deps } from "../lib/llm";

/**
 * Global guard, loaded before every test file via bunfig.toml's [test] preload.
 *
 * Replaces _deps.generateObject with a thrower so any suite that forgets to stub it
 * fails loudly at the call site instead of silently depending on env hygiene (e.g. an
 * invalid/missing OPENAI_API_KEY happening to produce a network error that a catch
 * block swallows into a fallback value).
 *
 * Suites that need to exercise generateObject assign their own stub and are
 * responsible for restoring this thrower afterwards (see the save/restore pattern in
 * src/test/integrations/openai.test.ts).
 */
_deps.generateObject = (async () => {
  throw new Error("Real LLM call attempted in test");
}) as typeof _deps.generateObject;
