import { randomBytes } from "node:crypto";
import { build } from "vite";
process.env.BUILD_ID ??=
  new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14) +
  "-" +
  randomBytes(3).toString("hex");
await import("./pdf-assets.mjs");
await build();
await import("./service-worker.mjs");
