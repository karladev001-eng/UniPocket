import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const nodeRange = '>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1 <27';
export function supportedNode(version) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  const floor = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }[major];
  return !!floor && (minor > floor[0] || minor === floor[0] && patch >= floor[1]);
}
export function assertNode(version = process.versions.node) {
  if (!supportedNode(version)) throw Error(`Unsupported Node.js ${version}. Install patched Node.js ${nodeRange}, then run npm ci.`);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('TLS verification is disabled. Unset NODE_TLS_REJECT_UNAUTHORIZED and retry.');
}
export const webRoot = fileURLToPath(new URL('../', import.meta.url));
export const receiptPath = resolve(webRoot, '.wrangler/tls-verification.json');
const hash = data => createHash('sha256').update(data).digest('hex');
export function caFile(env = process.env, platform = process.platform) {
  const candidates = env.UNI_POCKET_CA_FILE ? [resolve(env.UNI_POCKET_CA_FILE)] : platform === 'darwin'
    ? ['/opt/homebrew/etc/ca-certificates/cert.pem', '/usr/local/etc/ca-certificates/cert.pem']
    : platform === 'linux' ? ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'] : [];
  const path = candidates.find(file => existsSync(file));
  if (!path) throw Error('No maintained CA bundle found. Update your system/Homebrew ca-certificates, or set UNI_POCKET_CA_FILE to its PEM bundle; run npm run verify:tls.');
  try {
    const contents = readFileSync(path, 'utf8');
    const certificates = contents.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) throw Error('No certificates');
    for (const certificate of certificates) new X509Certificate(certificate);
    return { path, sha256: hash(contents) };
  } catch { throw Error(`Invalid CA bundle: ${path}. Select a readable maintained PEM bundle and run npm run verify:tls.`); }
}
export function verificationKey(ca) {
  return hash(JSON.stringify({ ca, node: process.versions.node, platform: process.platform, arch: process.arch, lock: hash(readFileSync(resolve(webRoot, 'package-lock.json'))), guard: hash(readFileSync(new URL('./runtime.mjs', import.meta.url))), verifier: hash(readFileSync(new URL('./verify-tls.mjs', import.meta.url))) }));
}
export function validReceipt(receipt, key, now = Date.now()) {
  return receipt?.key === key && Number.isFinite(receipt.verifiedAt) && receipt.verifiedAt <= now && now - receipt.verifiedAt < 7 * 86400000;
}
export function readValidReceipt(path, key) {
  try { return validReceipt(JSON.parse(readFileSync(path, 'utf8')), key); } catch { return false; }
}
export function configureWorkerd({ requireVerified = true } = {}) {
  assertNode();
  if (process.env.MINIFLARE_WORKERD_PATH || process.env.WORKERD_BINARY_PATH) throw Error('Unset custom workerd binary overrides; use npm ci and run npm run verify:tls.');
  if (process.env.NODE_EXTRA_CA_CERTS) throw Error('Unset NODE_EXTRA_CA_CERTS; choose the complete maintained bundle with UNI_POCKET_CA_FILE and run npm run verify:tls.');
  const ca = caFile();
  if (requireVerified) {
    if (!readValidReceipt(receiptPath, verificationKey(ca))) throw Error('Local workerd TLS trust is unverified or changed. Run npm run verify:tls with network access, then retry (verification lasts 7 days).');
  }
  // workerd uses OpenSSL's maintained file. Do not inherit a different directory
  // or supplement it with an unverified extra bundle.
  process.env.SSL_CERT_FILE = ca.path;
  process.env.SSL_CERT_DIR = '';
  return ca;
}
export function invalidateVerification(path = receiptPath) { rmSync(path, { force:true }); }
export function recordVerification(ca) {
  const current = caFile();
  if (current.path !== ca.path || current.sha256 !== ca.sha256) throw Error('CA bundle changed during verification. Run npm run verify:tls again.');
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify({ key: verificationKey(ca), verifiedAt: Date.now() }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) assertNode();
