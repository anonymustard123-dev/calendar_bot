import { NextResponse } from 'next/server';
import { hasDashboardAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

const ALLOWED_PATH = 'rest/v1/calendar_team_workspaces';

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!await hasDashboardAccess()) return NextResponse.json({ error: 'Dashboard access required.' }, { status: 401 });
  const { path } = await context.params;
  if (path.join('/') !== ALLOWED_PATH) return NextResponse.json({ error: 'This Supabase route is not available.' }, { status: 404 });

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.json({ error: 'Supabase proxy is not configured.' }, { status: 503 });
  // Accept either the Project URL or the Data API URL copied from Supabase,
  // with or without the trailing slash: https://ref.supabase.co/rest/v1/.
  const projectUrl = SUPABASE_URL.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const target = `${projectUrl}/${ALLOWED_PATH}${new URL(request.url).search}`;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', Prefer: request.headers.get('prefer') || 'return=representation' },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      cache: 'no-store',
    });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' } });
  } catch (error) {
    return NextResponse.json({ error: 'Could not reach Supabase.', detail: error instanceof Error ? error.message : 'Unknown connection error' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH };
