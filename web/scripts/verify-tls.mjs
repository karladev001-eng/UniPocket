import assert from "node:assert/strict";
import { request } from "node:https";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import {
  configureWorkerd,
  recordVerification,
  invalidateVerification,
  verificationKey,
  webRoot,
} from "./runtime.mjs";

export const targets = [
  "https://registry.npmjs.org/",
  "https://dv-g3b-emudhra.we-have-a-problem.com/",
  "https://dv-g3b-aaa-emudhra.we-have-a-problem.com/",
  "https://dv-g3b-noct-emudhra.we-have-a-problem.com/",
  "https://dv-g3b-aaa-noct-emudhra.we-have-a-problem.com/",
];
// No arbitrary destinations, credentials, redirects or application data.
const worker = `const targets = ${JSON.stringify(targets)};
export default { async fetch(request) {
  const index = Number(new URL(request.url).pathname.slice(1));
  if (!Number.isInteger(index) || !targets[index]) return new Response('Not found', {status:404});
  try {
    const response = await fetch(targets[index], { method:'HEAD', redirect:'manual', signal:AbortSignal.timeout(15000) });
    return Response.json({ accepted:true, status:response.status });
  } catch (error) { return Response.json({ accepted:false, error:String(error) }); }
} };`;
export function certificateFailure(code) {
  return [
    "CERT_REVOKED",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_UNTRUSTED",
    "SELF_SIGNED_CERT_IN_CHAIN",
  ].includes(code);
}
async function httpsControl(url, ca) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "HEAD",
        ca: readFileSync(ca.path),
        agent: false,
        rejectUnauthorized: true,
      },
      (response) => {
        response.resume();
        resolve({ accepted: true, status: response.statusCode });
      },
    );
    req.setTimeout(15000, () => req.destroy(Error("TLS probe timed out")));
    req.on("error", (error) =>
      certificateFailure(error.code)
        ? resolve({ accepted: false, certificateError: error.code })
        : reject(error),
    );
    req.end();
  });
}
export async function checkRuntime(name, dispatch) {
  const results = [];
  for (const [index, url] of targets.entries()) {
    const result = await dispatch(index);
    if (index === 0)
      assert.ok(
        result.accepted && result.status >= 200 && result.status < 400,
        `${name}: normal HTTPS failed: ${JSON.stringify(result)}`,
      );
    else {
      assert.equal(
        result.accepted,
        false,
        `${name}: compromised certificate was accepted: ${url}`,
      );
      assert.ok(
        certificateFailure(result.certificateError) ||
          /^Error: internal error; reference = [a-z0-9]+$/.test(
            result.error || "",
          ),
        `${name}: unexpected non-certificate runtime error for ${url}: ${JSON.stringify(result)}`,
      );
    }
    results.push({ url, ...result });
  }
  console.log(JSON.stringify({ runtime: name, results }));
}
export async function verifyTls() {
  // A failed fresh verification must revoke any earlier success immediately.
  invalidateVerification();
  const ca = configureWorkerd({ requireVerified: false });
  const initialKey = verificationKey(ca);
  // workerd intentionally hides its underlying TLS exception. Require a
  // certificate-specific failure from an independent HTTPS control using the
  // exact same CA file; DNS/timeouts/connection failures cannot satisfy this.
  await checkRuntime("Node HTTPS certificate control", (index) =>
    httpsControl(targets[index], ca),
  );
  const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: worker,
      compatibilityDate: "2026-10-18",
    }),
  );
  try {
    await checkRuntime("Miniflare test runtime", async (index) =>
      (await mf.dispatchFetch("https://tls-probe.test/" + index)).json(),
    );
  } finally {
    await mf.dispose();
  }
  const directory = await mkdtemp(join(tmpdir(), "uni-pocket-tls-"));
  let child,
    output = "";
  try {
    await writeFile(join(directory, "worker.mjs"), worker);
    await writeFile(
      join(directory, "wrangler.json"),
      JSON.stringify({
        name: "uni-pocket-tls-probe",
        main: "worker.mjs",
        compatibility_date: "2026-10-18",
      }),
    );
    // This is the same locked CLI and inherited environment used by the project
    // wrapper. Bootstrap verification runs before a receipt can exist.
    child = spawn(
      process.execPath,
      [
        join(webRoot, "node_modules/wrangler/bin/wrangler.js"),
        "dev",
        "--config",
        join(directory, "wrangler.json"),
        "--ip",
        "127.0.0.1",
        "--port",
        "0",
        "--inspector-port",
        "0",
        "--persist-to",
        join(directory, "state"),
      ],
      {
        cwd: webRoot,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", (error) => {
      output += error.message;
    });
    let base;
    for (let attempt = 0; attempt < 600; attempt++) {
      base = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (base) break;
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error("Wrangler TLS probe failed: " + output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!base) throw Error("Wrangler TLS probe startup timed out: " + output);
    await checkRuntime("Wrangler local runtime", async (index) =>
      (
        await fetch(base + "/" + index, { signal: AbortSignal.timeout(20000) })
      ).json(),
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
  // Only a fully successful run authorizes this exact CA/toolchain locally.
  assert.equal(
    verificationKey(ca),
    initialKey,
    "Toolchain changed during verification; retry npm run verify:tls.",
  );
  recordVerification(ca);
  console.log(
    "TLS verified: valid HTTPS works; all four compromised certificates rejected in both local runtimes. CA: " +
      ca.path,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    await verifyTls();
  } catch (error) {
    console.error(
      "TLS verification failed: " +
        error.message +
        "\nCheck network access and update the maintained CA bundle, then retry npm run verify:tls. Local workerd remains blocked.",
    );
    process.exitCode = 1;
  }
}
