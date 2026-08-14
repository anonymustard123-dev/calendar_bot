'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { CalendarEvent, StoredCalendar, UploadedCalendar, friendlyOwner, parseCalendar, reviveCalendar } from '@/lib/calendar';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileUp,
  Globe2,
  MessageCircle,
  Send,
  UploadCloud,
  UsersRound,
  X,
} from 'lucide-react';

type UploadResult = { calendars: UploadedCalendar[]; errors: string[] };
type TeamWorkspaceRow = { calendars?: StoredCalendar[] };

const STORAGE_KEY = 'bny-client-meeting-intelligence-v1';
type PersistedCalendars = { personal: UploadedCalendar | null; team: UploadedCalendar[] };
const EMPTY_PERSISTED_CALENDARS: PersistedCalendars = { personal: null, team: [] };
const calendarListeners = new Set<() => void>();
let storedCalendars: PersistedCalendars | undefined;

const acceptedFile = (file: File) => /\.(ics|txt)$/i.test(file.name);

function readStoredCalendars(): PersistedCalendars {
  if (typeof window === 'undefined') return EMPTY_PERSISTED_CALENDARS;
  if (storedCalendars) return storedCalendars;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const state = saved ? JSON.parse(saved) as { personal?: StoredCalendar | null; team?: StoredCalendar[] } : {};
    storedCalendars = { personal: state.personal ? reviveCalendar(state.personal) : null, team: (state.team ?? []).map(reviveCalendar) };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    storedCalendars = EMPTY_PERSISTED_CALENDARS;
  }
  return storedCalendars;
}

function subscribeToCalendars(listener: () => void) {
  calendarListeners.add(listener);
  return () => calendarListeners.delete(listener);
}

function saveCalendars(next: PersistedCalendars) {
  storedCalendars = next;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  calendarListeners.forEach((listener) => listener());
}

async function fetchSharedTeamCalendars(): Promise<UploadedCalendar[] | null> {
  const response = await fetch('/api/supabase/rest/v1/calendar_team_workspaces?workspace_key=eq.team-calendars&select=calendars', { cache: 'no-store' });
  if (response.status === 503) return null;
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not load team calendars.');
  const rows = await response.json() as TeamWorkspaceRow[];
  return rows[0]?.calendars?.map(reviveCalendar) ?? [];
}

async function saveSharedTeamCalendars(team: UploadedCalendar[]) {
  const response = await fetch('/api/supabase/rest/v1/calendar_team_workspaces?on_conflict=workspace_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ workspace_key: 'team-calendars', calendars: team }),
  });
  if (response.status === 503) return false;
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not save team calendars.');
  return true;
}

async function readCalendars(files: FileList | File[]): Promise<UploadResult> {
  const uploads = await Promise.all(
    Array.from(files).map(async (file): Promise<UploadedCalendar | string> => {
      if (!acceptedFile(file)) return `${file.name}: please upload an .ics or .txt calendar file.`;
      try {
        const events = parseCalendar(await file.text(), friendlyOwner(file.name));
        return { id: `${file.name}-${file.lastModified}-${file.size}`, name: file.name, owner: friendlyOwner(file.name), events };
      } catch {
        return `${file.name}: this does not appear to be a valid iCalendar file.`;
      }
    }),
  );
  return {
    calendars: uploads.filter((upload): upload is UploadedCalendar => typeof upload !== 'string'),
    errors: uploads.filter((upload): upload is string => typeof upload === 'string'),
  };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function UploadZone({ multiple, onUpload }: { multiple?: boolean; onUpload: (files: FileList | File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    onUpload(event.dataTransfer.files);
  }, [onUpload]);

  return (
    <div
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={handleDrop}
      className={`rounded-2xl border border-dashed p-6 text-center transition sm:p-8 ${dragging ? 'border-bny-teal bg-bny-teal/10' : 'border-white/20 bg-white/[0.035] hover:border-bny-teal/65 hover:bg-white/[0.055]'}`}
    >
      <input ref={inputRef} type="file" accept=".ics,.txt,text/calendar,text/plain" multiple={multiple} className="hidden" onChange={(event) => event.target.files && onUpload(event.target.files)} />
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-bny-teal/15 text-bny-teal"><UploadCloud className="h-6 w-6" /></div>
      <p className="mt-4 text-sm font-semibold text-bny-paper">Drag & drop {multiple ? 'calendar files' : 'your calendar file'} here</p>
      <p className="mt-1 text-xs leading-5 text-bny-paper/55">Accepts .ics and .txt files. Parsing happens securely in your browser.</p>
      <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-bny-teal px-4 py-2.5 text-sm font-bold text-bny-deep transition hover:bg-[#8adbe2]">
        <FileUp className="h-4 w-4" /> Browse files
      </button>
    </div>
  );
}

function EventList({ events, showOwner = false }: { events: CalendarEvent[]; showOwner?: boolean }) {
  if (!events.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><CalendarDays className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No upcoming client meetings found</p><p className="mt-1 text-xs text-bny-paper/55">Upload a calendar to identify meetings with non-BNY attendees.</p></div>;
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#002c47]/65">
    <div className="hidden grid-cols-[1.35fr_.95fr_.8fr_1.6fr] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[.16em] text-bny-paper/45 md:grid">
      <span>Meeting</span><span>Date & time</span>{showOwner && <span>Calendar owner</span>}{!showOwner && <span>Duration</span>}<span>External attendees</span>
    </div>
    <div className="divide-y divide-white/10">
      {events.map((event) => <article key={event.id} className={`grid gap-3 px-5 py-5 md:items-center md:gap-4 ${showOwner ? 'md:grid-cols-[1.35fr_.95fr_.8fr_1.6fr]' : 'md:grid-cols-[1.35fr_.95fr_.8fr_1.6fr]'}`}>
        <div><p className="font-semibold text-bny-paper">{event.title}</p><p className="mt-1 text-xs text-bny-paper/50 md:hidden">{formatDate(event.start)} · {formatTime(event.start)} – {formatTime(event.end)}</p></div>
        <div className="hidden text-sm text-bny-paper/75 md:block"><p>{formatDate(event.start)}</p><p className="mt-1 text-xs text-bny-teal">{formatTime(event.start)} – {formatTime(event.end)}</p></div>
        <div className="text-sm text-bny-paper/70"><span className="md:hidden text-xs uppercase tracking-wider text-bny-paper/45">{showOwner ? 'Owner: ' : 'Duration: '}</span>{showOwner ? event.owner : `${Math.max(0, Math.round((event.end.getTime() - event.start.getTime()) / 60000))} min`}</div>
        <div className="flex flex-wrap gap-1.5">{event.externalAttendees.map((email) => <span key={email} className="rounded-full border border-bny-gold/35 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{email}</span>)}</div>
      </article>)}
    </div>
  </div>;
}

function ClientTracker({ events }: { events: CalendarEvent[] }) {
  const clients = useMemo(() => {
    const grouped = new Map<string, { domain: string; contacts: Set<string>; owners: Set<string>; events: CalendarEvent[] }>();
    events.forEach((event) => event.externalAttendees.forEach((email) => {
      const domain = email.split('@')[1]?.toLowerCase() || email.toLowerCase();
      const client = grouped.get(domain) ?? { domain: domain.replace(/\.[^.]+$/, ''), contacts: new Set<string>(), owners: new Set<string>(), events: [] };
      client.contacts.add(email);
      client.owners.add(event.owner);
      if (!client.events.some((meeting) => meeting.id === event.id)) client.events.push(event);
      grouped.set(domain, client);
    }));
    return [...grouped.values()].map((client) => ({ ...client, events: client.events.sort((a, b) => a.start.getTime() - b.start.getTime()) })).sort((a, b) => a.events[0].start.getTime() - b.events[0].start.getTime());
  }, [events]);

  return <ClientTrackerRows clients={clients} />;

  if (!clients.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><UsersRound className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No client relationships found</p><p className="mt-1 text-xs text-bny-paper/55">Upload team calendars or expand the selected date range.</p></div>;
  return <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#002c47]/65"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-white/10 text-[11px] font-bold uppercase tracking-[.16em] text-bny-paper/45"><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Client contacts</th><th className="px-5 py-3">BNY team</th><th className="px-5 py-3">Next conversation</th><th className="px-5 py-3">Upcoming</th></tr></thead><tbody className="divide-y divide-white/10">{clients.map((client) => { const next = client.events[0]; return <tr key={client.domain} className="align-top"><td className="px-5 py-5"><p className="font-semibold text-bny-paper">{client.domain}</p><p className="mt-1 text-xs text-bny-paper/45">External organization</p></td><td className="px-5 py-5"><div className="flex max-w-60 flex-wrap gap-1.5">{[...client.contacts].map((contact) => <span key={contact} className="rounded-full border border-bny-gold/35 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{contact}</span>)}</div></td><td className="px-5 py-5 text-sm text-bny-paper/75">{[...client.owners].join(', ')}</td><td className="px-5 py-5"><p className="text-sm font-medium text-bny-paper">{formatDate(next.start)}</p><p className="mt-1 text-xs text-bny-teal">{formatTime(next.start)} · {next.title}</p></td><td className="px-5 py-5"><span className="rounded-full bg-bny-teal/15 px-2.5 py-1 text-xs font-semibold text-bny-teal">{client.events.length} meeting{client.events.length === 1 ? '' : 's'}</span></td></tr>; })}</tbody></table></div>;
}

type ClientGroup = { domain: string; contacts: Set<string>; owners: Set<string>; events: CalendarEvent[] };

function ClientTrackerRows({ clients }: { clients: ClientGroup[] }) {
  if (!clients.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><UsersRound className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No client relationships found</p><p className="mt-1 text-xs text-bny-paper/55">Upload a calendar or expand the selected date range.</p></div>;
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#002c47]/65">
    <div className="hidden grid-cols-[minmax(120px,.8fr)_minmax(170px,1.3fr)_minmax(110px,.8fr)_minmax(150px,1fr)_100px] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[.16em] text-bny-paper/45 lg:grid"><span>Client</span><span>Client contacts</span><span>BNY team</span><span>Next conversation</span><span>Upcoming</span></div>
    <div className="divide-y divide-white/10">{clients.map((client) => { const next = client.events[0]; return <article key={client.domain} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(120px,.8fr)_minmax(170px,1.3fr)_minmax(110px,.8fr)_minmax(150px,1fr)_100px] lg:items-start"><div className="min-w-0"><p className="break-words font-semibold text-bny-paper">{client.domain}</p><p className="mt-1 text-xs text-bny-paper/45">External organization</p></div><div className="min-w-0"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Client contacts</p><div className="flex flex-wrap gap-1.5">{[...client.contacts].map((contact) => <span key={contact} className="max-w-full break-all rounded-full border border-bny-gold/35 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{contact}</span>)}</div></div><div className="min-w-0 text-sm text-bny-paper/75"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">BNY team</p><p className="break-words">{[...client.owners].join(', ')}</p></div><div className="min-w-0"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Next conversation</p><p className="text-sm font-medium text-bny-paper">{formatDate(next.start)}</p><p className="mt-1 break-words text-xs leading-5 text-bny-teal">{formatTime(next.start)} · {next.title}</p></div><div><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Upcoming</p><span className="inline-flex whitespace-nowrap rounded-full bg-bny-teal/15 px-2.5 py-1 text-xs font-semibold text-bny-teal">{client.events.length} meeting{client.events.length === 1 ? '' : 's'}</span></div></article>; })}</div>
  </div>;
}

function CalendarControls({
  rangeDays,
  search,
  onRangeChange,
  onSearchChange,
}: {
  rangeDays: 7 | 30 | 90;
  search: string;
  onRangeChange: (days: 7 | 30 | 90) => void;
  onSearchChange: (value: string) => void;
}) {
  return <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-bny-deep/70 p-1" aria-label="Date range">
      {([7, 30, 90] as const).map((days) => <button key={days} type="button" onClick={() => onRangeChange(days)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${rangeDays === days ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/65 hover:text-bny-paper'}`}>Next {days} days</button>)}
    </div>
    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-bny-deep/40 px-3 py-2 text-sm text-bny-paper/55 sm:w-72">
      <span className="sr-only">Search meetings</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
      <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search title or attendee" className="min-w-0 flex-1 bg-transparent text-sm text-bny-paper outline-none placeholder:text-bny-paper/35" />
    </label>
  </div>;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function CalendarChat({ personalEvents, teamEvents }: { personalEvents: CalendarEvent[]; teamEvents: CalendarEvent[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Ask me about upcoming meetings, clients, or team coverage.' }]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const calendarContext = useMemo(() => [
    ...personalEvents.map((event) => ({ scope: 'My Calendar' as const, title: event.title, start: event.start.toISOString(), end: event.end.toISOString(), externalAttendees: event.externalAttendees })),
    ...teamEvents.map((event) => ({ scope: 'Team Calendars' as const, title: event.title, start: event.start.toISOString(), end: event.end.toISOString(), owner: event.owner, externalAttendees: event.externalAttendees })),
  ].slice(0, 160), [personalEvents, teamEvents]);

  const ask = useCallback(async (question: string) => {
    const content = question.trim();
    if (!content || sending) return;
    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    try {
      const response = await fetch('/api/calendar-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: nextMessages.slice(1), calendarContext }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Calendar chat is unavailable.');
      setMessages((current) => [...current, { role: 'assistant', content: data.answer }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error instanceof Error ? error.message : 'Calendar chat is unavailable.' }]);
    } finally {
      setSending(false);
    }
  }, [calendarContext, messages, sending]);

  return <aside className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#001f35]/80 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]">
    <div className="border-b border-white/10 px-5 py-4"><div className="flex items-center gap-2 text-bny-teal"><MessageCircle className="h-5 w-5" /><h2 className="font-semibold">Ask your calendar</h2></div><p className="mt-1 text-xs leading-5 text-bny-paper/55">Answers are based on the meetings in your selected date range.</p></div>
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`max-w-[92%] rounded-2xl px-3.5 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-bny-teal text-bny-deep' : 'bg-white/[.07] text-bny-paper/80'}`}>{message.content}</div>)}{sending && <div className="w-fit rounded-2xl bg-white/[.07] px-3.5 py-3 text-sm text-bny-paper/60">Reviewing your calendar…</div>}</div>
    <div className="border-t border-white/10 p-4"><div className="mb-3 flex flex-wrap gap-2">{['Who am I meeting next week?', 'Which clients have the most meetings?', 'Summarize team client coverage.'].map((question) => <button key={question} type="button" disabled={sending} onClick={() => void ask(question)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-bny-paper/65 transition hover:border-bny-teal/50 hover:text-bny-teal disabled:opacity-50">{question}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void ask(draft); }} className="flex items-end gap-2 rounded-xl border border-white/10 bg-bny-deep/50 p-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Ask about your calendar…" className="min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-bny-paper outline-none placeholder:text-bny-paper/35" /><button type="submit" disabled={!draft.trim() || sending} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bny-teal text-bny-deep transition hover:bg-[#8adbe2] disabled:cursor-not-allowed disabled:opacity-45"><Send className="h-4 w-4" /><span className="sr-only">Send message</span></button></form></div>
  </aside>;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'personal' | 'team'>('personal');
  const persistedCalendars = useSyncExternalStore(subscribeToCalendars, readStoredCalendars, () => EMPTY_PERSISTED_CALENDARS);
  const { personal, team } = persistedCalendars;
  const [errors, setErrors] = useState<string[]>([]);
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [search, setSearch] = useState('');
  const [personalView, setPersonalView] = useState<'meetings' | 'tracker'>('meetings');
  const [teamView, setTeamView] = useState<'meetings' | 'tracker'>('meetings');
  const persist = useCallback((next: PersistedCalendars, syncTeam = false) => {
    saveCalendars(next);
    if (!syncTeam) return;
    void saveSharedTeamCalendars(next.team).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrateTeam() {
      try {
        const remoteTeam = await fetchSharedTeamCalendars();
        if (cancelled) return;
        const current = readStoredCalendars();
        if (remoteTeam === null) return;
        if (remoteTeam.length > 0) saveCalendars({ ...current, team: remoteTeam });
        else if (current.team.length > 0) await saveSharedTeamCalendars(current.team);
      } catch { /* Team data remains available from browser storage. */ }
    }
    void hydrateTeam();
    return () => { cancelled = true; };
  }, []);

  const filterEvents = useCallback((events: CalendarEvent[]) => {
    const now = new Date();
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + rangeDays);
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      const isWithinRange = event.end >= now && event.start <= rangeEnd;
      const matchesSearch = !query || [event.title, event.owner, ...event.externalAttendees].join(' ').toLowerCase().includes(query);
      return isWithinRange && matchesSearch;
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [rangeDays, search]);

  const personalEvents = useMemo(() => filterEvents(personal?.events ?? []), [filterEvents, personal]);
  const teamEvents = useMemo(() => filterEvents(team.flatMap((calendar) => calendar.events)), [filterEvents, team]);

  const uploadPersonal = useCallback(async (files: FileList | File[]) => {
    const result = await readCalendars(files);
    setErrors(result.errors);
    if (result.calendars[0]) persist({ ...readStoredCalendars(), personal: result.calendars[0] });
  }, [persist]);
  const uploadTeam = useCallback(async (files: FileList | File[]) => {
    const result = await readCalendars(files);
    setErrors(result.errors);
    const current = readStoredCalendars();
    persist({ ...current, team: [...current.team, ...result.calendars.filter((next) => !current.team.some((existing) => existing.id === next.id))] }, true);
  }, [persist]);
  const updateTeamOwner = useCallback((id: string, owner: string) => {
    const current = readStoredCalendars();
    persist({ ...current, team: current.team.map((calendar) => calendar.id === id ? { ...calendar, owner, events: calendar.events.map((event) => ({ ...event, owner })) } : calendar) }, true);
  }, [persist]);

  return <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
    <div className="mx-auto grid max-w-[1600px] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="min-w-0">
      <header className="flex flex-col gap-6 border-b border-white/10 pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4"><div className="flex h-14 w-20 items-center justify-center rounded-xl border border-white/10 bg-white/[.06] px-2"><Image src="/bny-logo.svg" alt="BNY" width={160} height={48} className="h-auto w-full" priority /></div><div><p className="text-[11px] font-bold uppercase tracking-[.22em] text-bny-teal">Workplace automation</p><h1 className="mt-1 text-xl font-semibold tracking-tight text-bny-paper sm:text-2xl">Client Meeting Intelligence</h1></div></div>
      </header>

      <section className="mt-7"><div className="flex gap-2 border-b border-white/10" role="tablist" aria-label="Calendar views">
        {([{ key: 'personal', label: 'My Calendar', icon: CalendarDays }, { key: 'team', label: 'Team Calendars', icon: UsersRound }] as const).map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${activeTab === key ? 'border-bny-teal text-bny-teal' : 'border-transparent text-bny-paper/55 hover:text-bny-paper'}`}><Icon className="h-4 w-4" />{label}</button>)}
      </div>

      <CalendarControls rangeDays={rangeDays} search={search} onRangeChange={setRangeDays} onSearchChange={setSearch} />

      {errors.length > 0 && <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div>{errors.map((error) => <p key={error}>{error}</p>)}</div><button type="button" onClick={() => setErrors([])} className="ml-auto"><X className="h-4 w-4" /></button></div>}

      {activeTab === 'personal' ? <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside><div className="rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><div className="flex items-center gap-2 text-bny-teal"><Globe2 className="h-5 w-5" /><h2 className="font-semibold">Personal calendar</h2></div><div className="mt-5"><UploadZone onUpload={uploadPersonal} /></div>{personal && <div className="mt-4 flex items-center justify-between rounded-xl bg-white/[.05] p-3 text-xs"><span className="max-w-56 truncate text-bny-paper/70">{personal.name}</span><button type="button" onClick={() => saveCalendars({ ...readStoredCalendars(), personal: null })} className="text-bny-teal hover:text-white">Remove</button></div>}</div></aside>
        <div><div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-bny-teal">Upcoming meetings</p><h2 className="mt-1 text-xl font-semibold">{personalView === 'tracker' ? 'My client meeting tracker' : 'My external client meetings'}</h2></div><div className="flex items-center gap-3"><div className="flex rounded-xl border border-white/10 bg-bny-deep/50 p-1"><button type="button" onClick={() => setPersonalView('meetings')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${personalView === 'meetings' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Meetings</button><button type="button" onClick={() => setPersonalView('tracker')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${personalView === 'tracker' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Client tracker</button></div>{personal && <span className="hidden items-center gap-1.5 text-xs text-bny-paper/60 sm:flex"><CheckCircle2 className="h-4 w-4 text-bny-teal" /> Filter active</span>}</div></div>{personalView === 'tracker' ? <ClientTracker events={personalEvents} /> : <EventList events={personalEvents} />}</div>
      </div> : <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside><div className="rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><div className="flex items-center gap-2 text-bny-teal"><UsersRound className="h-5 w-5" /><h2 className="font-semibold">Team calendar files</h2></div><div className="mt-5"><UploadZone multiple onUpload={uploadTeam} /></div>{team.length > 0 && <div className="mt-4 space-y-3">{team.map((calendar) => <div key={calendar.id} className="rounded-xl bg-white/[.05] p-3 text-xs"><p className="mb-2 truncate text-bny-paper/50">{calendar.name}</p><label className="block text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Calendar owner<input value={calendar.owner} onChange={(event) => updateTeamOwner(calendar.id, event.target.value)} placeholder="Team member name" className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/50 px-2.5 py-2 text-sm normal-case tracking-normal text-bny-paper outline-none placeholder:text-bny-paper/30 focus:border-bny-teal" /></label><button type="button" onClick={() => { const current = readStoredCalendars(); persist({ ...current, team: current.team.filter((item) => item.id !== calendar.id) }, true); }} className="mt-3 text-bny-teal hover:text-white">Remove</button></div>)}</div>}</div></aside>
        <div><div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-bny-teal">Team overview</p><h2 className="mt-1 text-xl font-semibold">{teamView === 'tracker' ? 'Client meeting tracker' : 'All external client meetings'}</h2></div><div className="flex items-center gap-3"><div className="flex rounded-xl border border-white/10 bg-bny-deep/50 p-1"><button type="button" onClick={() => setTeamView('meetings')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${teamView === 'meetings' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Meetings</button><button type="button" onClick={() => setTeamView('tracker')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${teamView === 'tracker' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Client tracker</button></div><span className="hidden items-center gap-1.5 text-xs text-bny-paper/60 sm:flex"><Clock3 className="h-4 w-4 text-bny-teal" /> Chronological</span></div></div>{teamView === 'tracker' ? <ClientTracker events={teamEvents} /> : <EventList events={teamEvents} showOwner />}</div>
      </div>}</section>

      <footer className="mt-10 flex items-center justify-between border-t border-white/10 py-5 text-xs text-bny-paper/40"><span>Client Meeting Intelligence</span><span className="flex items-center gap-1">Built for calendar visibility <ChevronRight className="h-3 w-3" /></span></footer>
    </div>
    <CalendarChat personalEvents={personalEvents} teamEvents={teamEvents} />
    </div>
  </main>;
}
