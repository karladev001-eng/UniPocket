import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertNode, configureWorkerd } from "./runtime.mjs";
assertNode();
const [command, ...args] = process.argv.slice(2);
const bins = {
  vite: "vite/bin/vite.js",
  tsc: "typescript/bin/tsc",
  vitest: "vitest/vitest.mjs",
  wrangler: "wrangler/bin/wrangler.js",
  prettier: "prettier/bin/prettier.cjs",
  eslint: "eslint/bin/eslint.js",
};
if (command === "wrangler") configureWorkerd();
if (command !== "node" && !Object.hasOwn(bins, command))
  throw Error("Unknown project tool: " + command);
const child = spawn(
  process.execPath,
  [
    ...(command === "node"
      ? []
      : [
          fileURLToPath(
            new URL("../node_modules/" + bins[command], import.meta.url),
          ),
        ]),
    ...args,
  ],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
