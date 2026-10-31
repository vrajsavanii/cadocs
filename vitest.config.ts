import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Harness timing only — no behavioral configuration.
 *
 * testTimeout is raised from Vitest's 5 s default because several test files
 * open an isolated SQLite database at first import (migration + seed warm-up)
 * and the full suite runs its files in parallel. Individual tests complete in
 * ~1 s once warm; the old default made cold parallel runs flaky without
 * reflecting any real regression.
 */
export default defineConfig({
  resolve: {
    // App code uses Next.js-style `@/lib/...` imports; mirror that here so
    // tests can import route handlers directly.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
