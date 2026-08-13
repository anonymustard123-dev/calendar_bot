import { NextResponse } from 'next/server';
import { accessCookie, createAccessToken, hasDashboardAccess, matchesPassword } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ authenticated: await hasDashboardAccess() });
}

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: '' }));
  if (!process.env.CALENDAR_ACCESS_PASSWORD) return NextResponse.json({ error: 'Access gate is not configured.' }, { status: 503 });
  if (!matchesPassword(String(password ?? ''))) return NextResponse.json({ error: 'Incorrect access password.' }, { status: 401 });
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(accessCookie.name, createAccessToken(), accessCookie.options);
  return response;
}

export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(accessCookie.name, '', { ...accessCookie.options, maxAge: 0 });
  return response;
}
