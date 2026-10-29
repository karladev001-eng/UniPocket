import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "dist/**",
      "dist-admin/**",
      "node_modules/**",
      ".wrangler/**",
      "coverage/**",
      // Static files and vendored PDF.js assets are served as-is.
      "public/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Default for everything: Node (config files, tests, build scripts).
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Browser PWA client and admin console.
    files: ["src/**/*.ts", "admin/src/**/*.ts", "tests/*client*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Cloudflare Worker API (service-worker-like runtime, not Node).
    files: ["server/**/*.ts"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["scripts/service-worker.mjs", "scripts/sw-template.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.serviceworker } },
  },
);
