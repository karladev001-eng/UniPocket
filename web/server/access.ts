import type { Env } from './types.ts';
import { ApiError } from './validation.ts';

interface AccessJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}
interface KeyCache {
  until: number;
  refreshedAt: number;
  keys: AccessJwk[];
}
const cached = new Map<string, KeyCache>();

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
function object(value: string): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(decode(value)));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
  return parsed;
}
async function loadKeys(team: string): Promise<KeyCache> {
  // Workers supports manual redirects; rejecting non-2xx prevents a team endpoint
  // redirect from moving the public-key request to an untrusted origin.
  const result = await fetch(`${team}/cdn-cgi/access/certs`, { redirect: 'manual' });
  if (!result.ok) throw Error();
  const data = await result.json() as { keys?: AccessJwk[] };
  if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 30) throw Error();
  const entry = { until: Date.now() + 5 * 60000, refreshedAt: Date.now(), keys: data.keys };
  cached.set(team, entry);
  return entry;
}

/** Verify every request, including HTML/assets, independently of the edge gate. */
export async function authenticate(request: Request, env: Env): Promise<{ email: string }> {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  const owner = env.ADMIN_OWNER_EMAIL;
  if (!team || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)
    || !aud?.trim() || !owner?.trim() || !env.APP_ORIGIN) {
    throw new ApiError(503, '管理者認証の設定が完了していません。', 'admin_not_configured');
  }
  const reject = () => new ApiError(401, '管理者の再ログインが必要です。入力は保持されます。', 'admin_auth_required');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw reject();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw Error();
    const header = object(parts[0]);
    const claims = object(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw Error();
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== team || !Array.isArray(claims.aud) || !claims.aud.includes(aud)
      || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now
      || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now + 60
      || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now))
      || typeof claims.email !== 'string' || claims.email.toLowerCase() !== owner.toLowerCase()) {
      throw Error();
    }
    let entry = cached.get(team);
    if (!entry || entry.until <= Date.now()) entry = await loadKeys(team);
    const findKey = () => entry!.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256'));
    let jwk = findKey();
    // Refresh once for rotation, bounded against forged unknown-kid requests.
    if (!jwk && Date.now() - entry.refreshedAt >= 30000) {
      entry = await loadKeys(team);
      jwk = findKey();
    }
    if (!jwk) throw Error();
    const publicKey = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey,
      decode(parts[2]), new TextEncoder().encode(parts.slice(0, 2).join('.')));
    if (!valid) throw Error();
    return { email: claims.email };
  } catch {
    throw reject();
  }
}
