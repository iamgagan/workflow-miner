import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/inngest/__tests__/setup.ts"],
    include: ["src/**/*.test.ts"],
    // local-shim.test.ts uses node:test (run via `node --experimental-strip-types --test`),
    // not vitest. Excluded so vitest doesn't try to load it.
    exclude: ["**/local-shim.test.ts", "node_modules", "dist", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
