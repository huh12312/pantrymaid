import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// NOTE: the timezone for this suite is pinned via `TZ=America/New_York` as a
// prefix on the `test` script in package.json, NOT here — mutating
// `process.env.TZ` after V8's Date/Intl internals initialize is unreliable,
// so it must be set at the process level before Node starts. This is not
// cosmetic: date-boundary bugs (e.g. the evening-rollover expiry-date logic)
// only diverge from correct behavior in a UTC-negative zone. Under UTC
// (what a bare `vitest run` or CI without the prefix would use), the old
// buggy `.toISOString()`-based code and the correct local-time code can
// produce the same string, so tests would pass either way and silently stop
// catching a regression. Do not remove the `TZ=` prefix from the `test`
// script as a "cleanup".
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "src/test/**", "**/*.config.*", "src/main.tsx"],
      // Baseline ratchet set just under current coverage to prevent regressions.
      // Raise toward the 80% target as untested flows (HouseSelector, SettingsPage,
      // Sidebar) gain tests.
      thresholds: {
        statements: 59,
        branches: 50,
        functions: 48,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
