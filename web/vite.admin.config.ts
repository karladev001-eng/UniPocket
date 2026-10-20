import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
    root: fileURLToPath(new URL("./admin", import.meta.url)),
    publicDir: false,
    server: { host: "127.0.0.1", port: 5174, proxy: { "/api": "http://127.0.0.1:8788" } },
    build: { outDir: "../dist-admin", emptyOutDir: true, target: "es2022" },
});
