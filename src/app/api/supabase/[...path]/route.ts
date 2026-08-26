import { NextResponse } from 'next/server';
import { hasDashboardAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

const ALLOWED_PATHS = new Set(['rest/v1/calendar_team_workspaces', 'rest/v1/calendar_client_profiles']);

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!await hasDashboardAccess()) return NextResponse.json({ error: 'Dashboard access required.' }, { status: 401 });
  const { path } = await context.params;
  const requestedPath = path.join('/');
  if (!ALLOWED_PATHS.has(requestedPath)) return NextResponse.json({ error: 'This Supabase route is not available.' }, { status: 404 });

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.json({ error: 'Supabase proxy is not configured.' }, { status: 503 });
  // Accept either the Project URL or the Data API URL copied from Supabase,
  // with or without the trailing slash: https://ref.supabase.co/rest/v1/.
  const projectUrl = SUPABASE_URL.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const target = `${projectUrl}/${requestedPath}${new URL(request.url).search}`;

  try {
    let requestBody = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    // A team workspace is a shared list. Merge at the server boundary so a
    // browser with an older cached list cannot erase another owner's calendar.
    if (request.method === 'POST' && requestedPath === 'rest/v1/calendar_team_workspaces' && requestBody) {
      const incoming = JSON.parse(requestBody) as { workspace_key?: string; calendars?: Array<{ id?: string }> };
      if (incoming.workspace_key === 'team-calendars' && Array.isArray(incoming.calendars)) {
        const existingResponse = await fetch(`${projectUrl}/${requestedPath}?workspace_key=eq.team-calendars&select=calendars`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, cache: 'no-store',
        });
        if (existingResponse.ok) {
          const existingRows = await existingResponse.json() as Array<{ calendars?: Array<{ id?: string }> }>;
          const existing = existingRows[0]?.calendars ?? [];
          const incomingIds = new Set(incoming.calendars.map((calendar) => calendar.id).filter(Boolean));
          incoming.calendars = [...existing.filter((calendar) => !incomingIds.has(calendar.id)), ...incoming.calendars];
          requestBody = JSON.stringify(incoming);
        }
      }
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', Prefer: request.headers.get('prefer') || 'return=representation' },
      body: requestBody,
      cache: 'no-store',
    });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' } });
  } catch (error) {
    return NextResponse.json({ error: 'Could not reach Supabase.', detail: error instanceof Error ? error.message : 'Unknown connection error' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH };
