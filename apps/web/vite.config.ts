import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// VITE_E2E_AUTH=mock compiles in the test-only auth driver. Only the E2E dev server sets it.
const e2eMockAuth = process.env.VITE_E2E_AUTH === "mock";

export default defineConfig({
  plugins: [react()],
  define: {
    __E2E_MOCK_AUTH__: JSON.stringify(e2eMockAuth),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
