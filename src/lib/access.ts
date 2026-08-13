import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'calendar_dashboard_access';
const MAX_AGE_SECONDS = 60 * 60 * 12;

function signature(payload: string) {
  return crypto.createHmac('sha256', process.env.CALENDAR_ACCESS_PASSWORD ?? '').update(payload).digest('base64url');
}

export function matchesPassword(supplied: string) {
  const configured = process.env.CALENDAR_ACCESS_PASSWORD;
  if (!configured) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(configured);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createAccessToken() {
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export async function hasDashboardAccess() {
  if (process.env.NODE_ENV !== 'production' && !process.env.CALENDAR_ACCESS_PASSWORD) return true;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !process.env.CALENDAR_ACCESS_PASSWORD) return false;
  const [payload, tokenSignature] = token.split('.');
  if (!payload || !tokenSignature) return false;
  const expected = signature(payload);
  if (tokenSignature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(tokenSignature), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).expiresAt > Date.now();
  } catch {
    return false;
  }
}

export const accessCookie = {
  name: COOKIE_NAME,
  options: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE_SECONDS },
};
