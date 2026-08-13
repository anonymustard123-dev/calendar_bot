import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'calendar_dashboard_access';

export function middleware(request: NextRequest) {
  // Local development remains usable before a password is configured.
  if (process.env.NODE_ENV !== 'production' && !process.env.CALENDAR_ACCESS_PASSWORD) return NextResponse.next();
  if (request.nextUrl.pathname === '/' && !request.cookies.has(COOKIE_NAME)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/login'] };
