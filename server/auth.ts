import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { ProfileRow } from './types.ts';

const MEDIA_SIGNING_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export const SESSION_COOKIE_NAME = 'clipforge_session';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    avatar_url: string | null;
    created_at: string;
  };
  sessionToken?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(keyHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, expiresAt, now.toISOString());
  return { token, expiresAt };
}

export function revokeSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`
  );
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractSessionToken(req: Request): {
  token: string | null;
  viaCookie: boolean;
} {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return { token, viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) return { token: cookieToken, viaCookie: true };
  return { token: null, viaCookie: false };
}

export function lookupUserBySessionToken(token: string): ProfileRow | null {
  const row = db
    .prepare(
      `SELECT p.id, p.email, p.password_hash, p.username, p.avatar_url, p.created_at, s.expires_at
       FROM sessions s
       JOIN profiles p ON p.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (ProfileRow & { expires_at: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  return row;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const { token, viaCookie } = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  // CSRF defense on cookie-authenticated mutations
  if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    const origin = req.headers.origin;
    const expectedHost = (req.headers['x-forwarded-host'] || req.headers.host || '')
      .toString()
      .split(',')[0]
      .trim();
    const hasCustomHeader = req.headers['x-requested-with'] === 'XMLHttpRequest';
    if (origin && expectedHost) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== expectedHost && !hasCustomHeader) {
          res.status(403).json({ error: 'Cross-origin request blocked.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid request origin.' });
        return;
      }
    } else if (!hasCustomHeader) {
      res.status(403).json({ error: 'Missing required request verification header.' });
      return;
    }
  }

  const user = lookupUserBySessionToken(token);
  if (!user) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  req.user = {
    id: user.id,
    email: user.email,
    username: user.username,
    avatar_url: user.avatar_url,
    created_at: user.created_at,
  };
  req.sessionToken = token;
  next();
}

export function createSignedMediaToken(
  userId: string,
  kind: 'source' | 'export' | 'music',
  resourceId: string,
  ttlSeconds = 3600
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}:${kind}:${resourceId}:${exp}`;
  const sig = crypto
    .createHmac('sha256', MEDIA_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`, 'utf8').toString('base64url');
}

export function verifySignedMediaToken(
  token: string,
  expectedKind: 'source' | 'export' | 'music',
  expectedResourceId: string
): { userId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 5) return null;
    const [userId, kind, resourceId, expStr, sig] = parts;
    if (kind !== expectedKind || resourceId !== expectedResourceId) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

    const payload = `${userId}:${kind}:${resourceId}:${expStr}`;
    const expectedSig = crypto
      .createHmac('sha256', MEDIA_SIGNING_SECRET)
      .update(payload)
      .digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    return { userId };
  } catch {
    return null;
  }
}
