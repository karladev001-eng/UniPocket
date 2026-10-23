import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { supportedNode, assertNode, nodeRange, validReceipt, caFile, configureWorkerd, invalidateVerification, readValidReceipt } from '../scripts/runtime.mjs';
import { certificateFailure, checkRuntime } from '../scripts/verify-tls.mjs';

test('only patched supported stable Node release lines pass every boundary', () => {
  for (const version of ['22.23.4','22.23.5','22.24.0','24.22.1','24.23.0','26.12.1','26.13.0']) assert.equal(supportedNode(version), true, version);
  for (const version of ['20.99.99','21.99.99','22.18.0','22.23.3','23.99.99','24.22.0','25.99.99','26.12.0','27.0.0','26.12.1-rc.1','garbage']) {
    assert.equal(supportedNode(version), false, version);
    assert.throws(() => assertNode(version), /Install patched Node/);
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.engines.node, nodeRange);
  assert.equal(lock.packages[''].engines.node, nodeRange);
  assert.match(readFileSync(new URL('../.npmrc', import.meta.url), 'utf8'), /^engine-strict=true$/m);
});
test('missing, changed, expired or future verification fails closed', () => {
  const now = Date.now();
  assert.equal(validReceipt({ key:'same', verifiedAt:now }, 'same', now), true);
  for (const receipt of [null, {}, { key:'old', verifiedAt:now }, { key:'same', verifiedAt:now - 7 * 86400000 }, { key:'same', verifiedAt:now + 1 }]) assert.equal(validReceipt(receipt, 'same', now), false);
});
test('invalid CA configuration and extra/unverified roots stop local runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tls-config-'));
  const invalid = join(dir, 'ca.pem'); writeFileSync(invalid, 'not a certificate');
  try {
    assert.throws(() => caFile({ UNI_POCKET_CA_FILE:join(dir, 'missing') }), /No maintained CA/);
    assert.throws(() => caFile({ UNI_POCKET_CA_FILE:invalid }), /Invalid CA/);
    assert.throws(() => caFile({}, 'win32'), /No maintained CA/);
    const saved = process.env.NODE_EXTRA_CA_CERTS;
    process.env.NODE_EXTRA_CA_CERTS = invalid;
    try { assert.throws(() => configureWorkerd(), /Unset NODE_EXTRA_CA_CERTS/); }
    finally { if (saved === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = saved; }
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
test('verification bypass is rejected by the real CLI entrypoint', () => {
  const result = spawnSync(process.execPath, ['scripts/run.mjs', 'vite', '--version'], { cwd:new URL('..', import.meta.url), env:{ ...process.env, NODE_TLS_REJECT_UNAUTHORIZED:'0' }, encoding:'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TLS verification is disabled/);
});
test('network errors do not count as certificate rejections', () => {
  for (const code of ['ENOTFOUND','ECONNRESET','ETIMEDOUT','ECONNREFUSED',undefined]) assert.equal(certificateFailure(code), false);
  assert.equal(certificateFailure('CERT_REVOKED'), true);
});

test('starting fresh verification invalidates the earlier receipt before probes can fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tls-receipt-')), file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify({ key:'previously verified', verifiedAt:Date.now() }));
  try { invalidateVerification(file); assert.equal(existsSync(file), false); invalidateVerification(file); }
  finally { rmSync(dir, { recursive:true, force:true }); }
});

test('corrupt or changed on-disk verification cannot authorize workerd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tls-receipt-read-')), file = join(dir, 'receipt.json');
  try {
    assert.equal(readValidReceipt(file, 'current'), false);
    writeFileSync(file, '{broken'); assert.equal(readValidReceipt(file, 'current'), false);
    writeFileSync(file, JSON.stringify({ key:'current', verifiedAt:Date.now() }));
    assert.equal(readValidReceipt(file, 'current'), true);
    assert.equal(readValidReceipt(file, 'different CA or runtime'), false);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
test('actual major tool entrypoint refuses an old Node runtime before launching it', () => {
  const code = `Object.defineProperty(process.versions, 'node', {value:'22.23.3'}); process.argv = ['node', 'scripts/run.mjs', 'vite', '--version']; await import('./scripts/run.mjs');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd:new URL('..', import.meta.url), encoding:'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Unsupported Node.js 22.23.3/);
});

// Run the actual npm installer with a simulated reported runtime version, not
// a second copy of our range predicate. No packages or network are involved.
test('npm engine-strict rejects vulnerable release floors even with install scripts disabled', () => {
  assert.ok(process.env.npm_execpath, 'run through npm run test:toolchain');
  const dir = mkdtempSync(join(tmpdir(), 'tls-npm-engine-'));
  const preload = join(dir, 'reported-node.mjs');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name:'tls-engine-check', version:'1.0.0', private:true, engines:{ node:nodeRange } }));
  writeFileSync(join(dir, '.npmrc'), 'engine-strict=true\n');
  try {
    for (const [version, accepted] of [['22.23.3',false],['24.22.0',false],['26.12.0',false],['22.23.4',true],['24.22.1',true],['26.12.1',true]]) {
      writeFileSync(preload, `Object.defineProperty(process, 'version', { value:'v${version}' }); Object.defineProperty(process.versions, 'node', { value:'${version}' });`);
      const result = spawnSync(process.execPath, ['--import', preload, process.env.npm_execpath, 'install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--fund=false', '--cache', join(dir, 'cache')], { cwd:dir, env:process.env, encoding:'utf8' });
      assert.equal(result.status === 0, accepted, version + ': ' + result.stderr);
      if (!accepted) assert.match(result.stderr, /EBADENGINE/);
    }
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('failed real verification revokes the previous local receipt and keeps startup blocked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tls-verifier-failure-')), scripts = join(dir, 'scripts'), state = join(dir, '.wrangler');
  mkdirSync(scripts); mkdirSync(state);
  for (const name of ['runtime.mjs','verify-tls.mjs','run.mjs']) writeFileSync(join(scripts, name), readFileSync(new URL('../scripts/' + name, import.meta.url)));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const receipt = join(state, 'tls-verification.json'); writeFileSync(receipt, JSON.stringify({ key:'previous verification', verifiedAt:Date.now() }));
  try {
    const disabled = spawnSync(process.execPath, [join(scripts, 'verify-tls.mjs')], { cwd:dir, env:{ ...process.env, NODE_TLS_REJECT_UNAUTHORIZED:'0' }, encoding:'utf8' });
    assert.notEqual(disabled.status, 0); assert.match(disabled.stderr, /TLS verification is disabled/);
    assert.equal(existsSync(receipt), false);
    writeFileSync(receipt, JSON.stringify({ key:'previous verification', verifiedAt:Date.now() }));
    const env = { ...process.env, UNI_POCKET_CA_FILE:join(dir, 'missing.pem') };
    const verified = spawnSync(process.execPath, [join(scripts, 'verify-tls.mjs')], { cwd:dir, env, encoding:'utf8' });
    assert.notEqual(verified.status, 0); assert.match(verified.stderr, /No maintained CA/);
    assert.equal(existsSync(receipt), false);
    const startup = spawnSync(process.execPath, [join(scripts, 'run.mjs'), 'wrangler', '--version'], { cwd:dir, env, encoding:'utf8' });
    assert.notEqual(startup.status, 0); assert.match(startup.stderr, /No maintained CA/);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('receipt tracks CA bytes, Node version, lockfile and both verification sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tls-receipt-drift-')), scripts = join(dir, 'scripts'); mkdirSync(scripts);
  writeFileSync(join(scripts, 'runtime.mjs'), readFileSync(new URL('../scripts/runtime.mjs', import.meta.url)));
  writeFileSync(join(scripts, 'verify-tls.mjs'), '// verifier fixture');
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  const code = `
    import assert from 'node:assert/strict';
    import {writeFileSync,readFileSync,existsSync} from 'node:fs';
    import {rootCertificates} from 'node:tls';
    const r = await import('./scripts/runtime.mjs');
    const caPath = new URL('./ca.pem', import.meta.url).pathname;
    writeFileSync(caPath, rootCertificates[0]); process.env.UNI_POCKET_CA_FILE = caPath;
    const ca = r.configureWorkerd({requireVerified:false}), key = r.verificationKey(ca);
    for (const path of ['package-lock.json','scripts/runtime.mjs','scripts/verify-tls.mjs']) {
      const original = readFileSync(path); writeFileSync(path, Buffer.concat([original,Buffer.from('changed')]));
      assert.notEqual(r.verificationKey(ca), key); writeFileSync(path, original);
    }
    const originalVersion = process.versions.node;
    Object.defineProperty(process.versions, 'node', {value:'26.12.2'}); assert.notEqual(r.verificationKey(ca), key);
    Object.defineProperty(process.versions, 'node', {value:originalVersion});
    writeFileSync(caPath, rootCertificates[0] + '\\n' + rootCertificates[1]);
    assert.throws(() => r.recordVerification(ca), /CA bundle changed during verification/);
    assert.equal(existsSync(r.receiptPath), false);
    assert.notEqual(r.verificationKey(r.caFile()), key);
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd:dir, env:process.env, encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('a runtime network failure cannot produce a successful TLS verification', async () => {
  for (const error of ['Error: Network connection lost.', 'TimeoutError: The operation was aborted due to timeout', 'Error: DNS lookup failed']) {
    await assert.rejects(checkRuntime('failed runtime fixture', async index => index === 0 ? { accepted:true, status:200 } : { accepted:false, error }), /unexpected non-certificate runtime error/);
  }
});
