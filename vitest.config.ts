import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/pbt/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
