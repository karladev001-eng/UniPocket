import { assertNode } from "./scripts/runtime.mjs";
assertNode();
import { defineConfig } from "vite";
export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? "development"),
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  build: { target: "es2022" },
});
