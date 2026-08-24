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
  Download,
  ChevronDown,
  ChevronUp,
  Mail,
  CalendarRange,
  FileUp,
  Globe2,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Send,
  UploadCloud,
  UsersRound,
  X,
} from 'lucide-react';

type UploadResult = { calendars: UploadedCalendar[]; errors: string[] };
type TeamWorkspaceRow = { calendars?: StoredCalendar[] };
type ClientProfileWorkspaceRow = { profiles?: ClientDirectory };

const STORAGE_KEY = 'bny-client-meeting-intelligence-v1';
const CLIENT_DIRECTORY_KEY = 'bny-client-directory-v1';
const INBOX_ACTIONS_KEY = 'bny-inbox-action-center-v1';
type PersistedCalendars = { personal: UploadedCalendar | null; team: UploadedCalendar[] };
type ClientProfile = { name: string; aliases: string[]; nextStep?: string };
type ClientDirectory = Record<string, ClientProfile>;
type PersistedInboxActions = { actions: InboxAction[]; summary: string; status: string };
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

async function fetchSharedClientProfiles(): Promise<ClientDirectory | null> {
  const response = await fetch('/api/supabase/rest/v1/calendar_client_profiles?workspace_key=eq.team-calendars&select=profiles', { cache: 'no-store' });
  if (response.status === 503 || response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load shared client profiles.');
  const rows = await response.json() as ClientProfileWorkspaceRow[];
  return rows[0]?.profiles ?? {};
}

async function saveSharedClientProfiles(profiles: ClientDirectory) {
  const response = await fetch('/api/supabase/rest/v1/calendar_client_profiles?on_conflict=workspace_key', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ workspace_key: 'team-calendars', profiles }) });
  if (response.status === 503 || response.status === 404) return false;
  if (!response.ok) throw new Error('Could not save shared client profiles.');
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
      <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-bny-teal px-4 py-2.5 text-sm font-bold text-bny-deep transition hover:bg-[#8adbe2]">
        <FileUp className="h-4 w-4" /> Browse files
      </button>
    </div>
  );
}

type InboxAction = { title: string; deadline: string; priority: 'high' | 'medium' | 'low'; from: string; context: string; directedAtYou: boolean };
type InboxEmail = { subject: string; body: string; from: string; to?: string; cc?: string; importance?: string };

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) { const char = text[index]; const next = text[index + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === ',' && !quoted) { row.push(cell); cell = ''; } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') index += 1; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; } else cell += char; }
  row.push(cell); if (row.some(Boolean)) rows.push(row); return rows;
}

function isDirectRyanMessage(email: InboxEmail) {
  const text = `${email.subject}\n${email.body}\n${email.from}`;
  const recipients = `${email.to ?? ''}\n${email.cc ?? ''}`.toLowerCase();
  const automated = /\b(my ?task|automatic reply|out of office|delivery status|undeliverable|read receipt|calendar invitation|meeting (?:accepted|declined)|sharepoint online)\b/i;
  return /sharma,\s*ryan|ryan\s+sharma/.test(recipients) && !automated.test(text);
}

function localInboxActions(emails: InboxEmail[]): InboxAction[] {
  const actionSignal = /\b(please|need|needed|action|required|respond|reply|review|approve|confirm|send|due|deadline|by\s+(?:eod|end of day|tomorrow|monday|tuesday|wednesday|thursday|friday|\d))/i;
  const systemNoise = /\b(automatic reply|out of office|delivery status|undeliverable|read receipt|calendar invitation|meeting (?:accepted|declined)|completed|thank you for your email)\b/i;
  const candidates = emails.filter((email) => actionSignal.test(`${email.subject}\n${email.body}`) && !systemNoise.test(`${email.subject}\n${email.body}`));
  return (candidates.length ? candidates : emails).slice(0, 20).map((email) => {
    const text = `${email.subject}\n${email.body}`;
    return { title: email.subject || 'Review email', deadline: text.match(/\b(?:due|by|before)\s+([^\n.;]{2,60})/i)?.[0] || 'No stated deadline', priority: /\b(urgent|asap|critical|eod|today)\b/i.test(text) ? 'high' : 'medium', from: email.from || 'Unknown sender', context: email.body.replace(/\s+/g, ' ').slice(0, 300) || 'Review this email for the requested action.', directedAtYou: true };
  });
}

function InboxActionCenter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [actions, setActions] = useState<InboxAction[]>([]);
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState('');
  const [mailWindow, setMailWindow] = useState<25 | 50 | 100>(50);
  const saveInboxActions = useCallback((next: PersistedInboxActions) => {
    try { window.localStorage.setItem(INBOX_ACTIONS_KEY, JSON.stringify(next)); } catch { /* Browser storage is optional. */ }
  }, []);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(INBOX_ACTIONS_KEY);
      if (!stored) return;
      const next = JSON.parse(stored) as PersistedInboxActions;
      setActions(Array.isArray(next.actions) ? next.actions : []);
      setSummary(typeof next.summary === 'string' ? next.summary : '');
      setStatus(typeof next.status === 'string' ? next.status : '');
    } catch { /* Ignore invalid stored inbox results. */ }
  }, []);
  const upload = useCallback(async (file?: File) => {
    if (!file) return;
    let emails: InboxEmail[] = [];
    setStatus('Reading mailbox…');
    try {
      const rows = parseCsv(await file.text()); const headers = rows.shift()?.map((value) => value.trim());
      if (!headers) throw new Error('Mailbox CSV is empty.');
      const column = (name: string) => headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
      const subject = column('Subject'); const body = column('Body'); const sender = column('From: (Name)'); const recipient = column('To: (Name)'); const cc = column('CC: (Name)'); const importance = column('Importance');
      if (subject < 0 || body < 0) throw new Error('Mailbox CSV must contain Subject and Body columns.');
      emails = rows.map((row) => ({ subject: row[subject] || '', body: row[body] || '', from: sender >= 0 ? row[sender] || '' : '', to: recipient >= 0 ? row[recipient] || '' : '', cc: cc >= 0 ? row[cc] || '' : '', importance: importance >= 0 ? row[importance] || '' : '' })).filter((email) => email.subject || email.body);
      setStatus('Finding outstanding actions…');
      const recentEmails = emails.slice(-mailWindow);
      const directEmails = recentEmails.filter(isDirectRyanMessage);
      setStatus(`Reviewing ${directEmails.length} direct messages to Ryan from the latest ${recentEmails.length} export rows...`);
      if (!directEmails.length) { const next = { actions: [], summary: 'No direct, non-automated messages to Ryan were found in this recent export window.', status: 'No relevant direct messages found' }; setActions(next.actions); setSummary(next.summary); setStatus(next.status); saveInboxActions(next); return; }
      const analysisEmails = directEmails.map((email) => ({ subject: email.subject.slice(0, 500), body: email.body.slice(0, 1200), from: email.from.slice(0, 240), to: email.to?.slice(0, 240) || '', cc: email.cc?.slice(0, 240) || '', importance: email.importance }));
      const response = await fetch('/api/inbox-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: analysisEmails, mailboxOrder: 'newest_last' }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Could not analyze mailbox.');
      const next = { actions: result.actions ?? [], summary: result.summary ?? '', status: result.notice || `${result.actions?.length ?? 0} outstanding items found` };
      setActions(next.actions); setSummary(next.summary); setStatus(next.status); saveInboxActions(next);
    } catch (error) { const fallback = localInboxActions(emails.slice(-mailWindow).filter(isDirectRyanMessage)); if (fallback.length > 0) { const next = { actions: fallback, summary: 'AI analysis was unavailable, so locally extracted action candidates are shown.', status: error instanceof Error ? `${error.message} Showing local action candidates.` : 'Showing local action candidates.' }; setActions(next.actions); setSummary(next.summary); setStatus(next.status); saveInboxActions(next); } else { const next = { actions: [], summary: '', status: error instanceof Error ? error.message : 'Could not read mailbox.' }; setActions(next.actions); setSummary(next.summary); setStatus(next.status); saveInboxActions(next); } }
  }, [mailWindow, saveInboxActions]);
  return <section className="mt-5 rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} /><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-2 text-bny-teal"><Mail className="h-5 w-5" /><h2 className="font-semibold">Inbox action center</h2></div><div className="flex items-center gap-2"><label className="text-xs text-bny-paper/55" htmlFor="mail-window">Review latest</label><select id="mail-window" value={mailWindow} onChange={(event) => setMailWindow(Number(event.target.value) as 25 | 50 | 100)} className="rounded-xl border border-white/10 bg-[#002a45] px-3 py-2 text-xs text-bny-paper outline-none"><option value={25}>25 emails</option><option value={50}>50 emails</option><option value={100}>100 emails</option></select><button type="button" onClick={() => inputRef.current?.click()} className="rounded-xl bg-bny-teal px-3 py-2 text-xs font-bold text-bny-deep">Upload mailbox CSV</button></div></div><p className="mt-2 text-[11px] text-bny-paper/40">Uses the last rows in this Outlook export, then keeps direct, non-automated messages to Ryan only.</p>{status && <p className="mt-3 text-xs text-bny-paper/55">{status}</p>}{summary && <p className="mt-3 rounded-xl bg-white/[.05] p-3 text-sm leading-6 text-bny-paper/80">{summary}</p>}{actions.length > 0 && <div className="mt-4 space-y-2">{actions.map((action, index) => <article key={`${action.title}-${index}`} className="rounded-xl border border-white/10 bg-white/[.035] p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-bny-paper">{action.title}</p><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${action.priority === 'high' ? 'bg-red-400/15 text-red-200' : action.priority === 'medium' ? 'bg-bny-gold/15 text-[#f0d89a]' : 'bg-bny-teal/15 text-bny-teal'}`}>{action.priority}</span></div><p className="mt-2 text-xs text-bny-teal">{action.deadline}</p><p className="mt-2 text-xs leading-5 text-bny-paper/75"><span className="font-semibold text-bny-paper">{action.from} said:</span> {action.context}</p><p className="mt-2 text-[11px] text-bny-paper/45">{action.directedAtYou ? 'Directed to Ryan' : 'Ryan was copied'}</p></article>)}</div>}</section>;
}

function EventList({ events, showOwner = false }: { events: CalendarEvent[]; showOwner?: boolean }) {
  if (!events.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><CalendarDays className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No upcoming client meetings found</p><p className="mt-1 text-xs text-bny-paper/55">Upload a calendar to identify meetings with non-BNY attendees.</p></div>;
  return <MeetingPanel events={events} showOwner={showOwner} />;
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

function MeetingPanel({ events, showOwner }: { events: CalendarEvent[]; showOwner: boolean }) {
  return <><VisualCalendar events={events} showOwner={showOwner} /><div className="overflow-hidden rounded-2xl border border-white/10 bg-[#002c47]/65"><div className="hidden grid-cols-[1.35fr_.95fr_.8fr_1.6fr] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[.16em] text-bny-paper/45 md:grid"><span>Meeting</span><span>Date & time</span><span>{showOwner ? 'Calendar owner' : 'Duration'}</span><span>External attendees</span></div><div className="divide-y divide-white/10">{events.map((event) => <article key={event.id} className="grid gap-3 px-5 py-5 md:grid-cols-[1.35fr_.95fr_.8fr_1.6fr] md:items-center md:gap-4"><div><p className="font-semibold text-bny-paper">{event.title}</p><p className="mt-1 text-xs text-bny-paper/50 md:hidden">{formatDate(event.start)} · {formatTime(event.start)} – {formatTime(event.end)}</p></div><div className="hidden text-sm text-bny-paper/75 md:block"><p>{formatDate(event.start)}</p><p className="mt-1 text-xs text-bny-teal">{formatTime(event.start)} – {formatTime(event.end)}</p></div><div className="text-sm text-bny-paper/70">{showOwner ? event.owner : `${Math.max(0, Math.round((event.end.getTime() - event.start.getTime()) / 60000))} min`}</div><div className="flex flex-wrap gap-1.5">{event.externalAttendees.map((email) => <span key={email} className="rounded-full border border-bny-gold/35 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{email}</span>)}</div></article>)}</div></div></>;
}

const ownerColors = ['#58c7d6', '#f0c66a', '#8d9cff', '#70d7a3', '#e68ca8', '#b59be8'];

function ownerColor(owner: string) {
  return owner.split('').reduce((total, letter) => total + letter.charCodeAt(0), 0) % ownerColors.length;
}

function VisualCalendar({ events, showOwner = false }: { events: CalendarEvent[]; showOwner?: boolean }) {
  const [isOpen, setIsOpen] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const start = useMemo(() => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setMonth(date.getMonth() + offset, 1); return date; }, [offset]);
  const days = useMemo(() => {
    const gridStart = new Date(start); gridStart.setDate(1 - gridStart.getDay());
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date; });
  }, [start]);
  const byDay = useMemo(() => new Map<string, CalendarEvent[]>(days.map((day) => [day.toDateString(), []])), [days]);
  events.forEach((event) => { const key = event.start.toDateString(); if (byDay.has(key)) byDay.get(key)?.push(event); });
  return <section className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-[#002c47]/65"><div className="flex items-center justify-between px-5 py-3"><div className="flex items-center gap-3"><CalendarRange className="h-4 w-4 text-bny-teal" /><p className="text-sm font-semibold text-bny-paper">Calendar</p>{isOpen && <span className="text-xs text-bny-paper/50">{start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>}</div><div className="flex items-center gap-2">{isOpen && <><button type="button" onClick={() => setOffset((current) => current - 1)} className="rounded-lg px-2 py-1 text-sm text-bny-paper/60 hover:bg-white/10">‹</button><button type="button" onClick={() => setOffset(0)} className="rounded-lg px-2 py-1 text-xs text-bny-paper/60 hover:bg-white/10">Today</button><button type="button" onClick={() => setOffset((current) => current + 1)} className="rounded-lg px-2 py-1 text-sm text-bny-paper/60 hover:bg-white/10">›</button></>}<button type="button" onClick={() => setIsOpen((current) => !current)} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-bny-paper/65 hover:border-bny-teal/50 hover:text-bny-teal">{isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{isOpen ? 'Collapse' : 'Expand'}</button></div></div>{isOpen && <><div className="grid grid-cols-7 border-y border-white/10 text-center text-[10px] font-bold uppercase tracking-[.12em] text-bny-paper/40">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="py-2">{day}</span>)}</div><div className="grid grid-cols-7">{days.map((day) => { const isCurrentMonth = day.getMonth() === start.getMonth(); const meetings = byDay.get(day.toDateString()) ?? []; return <div key={day.toISOString()} className={`min-h-20 border-b border-r border-white/[.07] p-1.5 ${isCurrentMonth ? 'bg-white/[.012]' : 'bg-bny-deep/20 text-bny-paper/30'}`}><p className="mb-1 text-right text-[10px] text-bny-paper/55">{day.getDate()}</p>{meetings.slice(0, 4).map((event) => <button type="button" key={event.id} onClick={() => setSelectedEvent(event)} style={{ borderLeftColor: showOwner ? ownerColors[ownerColor(event.owner)] : '#58c7d6' }} className="mb-1 block w-full truncate border-l-2 bg-white/[.055] px-1.5 py-1 text-left text-[10px] leading-4 text-bny-paper hover:bg-white/[.12]"><span className="text-bny-teal">{formatTime(event.start)}</span> {event.title}</button>)}{meetings.length > 4 && <p className="pl-1 text-[10px] text-bny-paper/45">+{meetings.length - 4} more</p>}</div>; })}</div>{showOwner && <div className="flex flex-wrap gap-3 border-t border-white/10 px-5 py-2 text-[10px] text-bny-paper/50">{[...new Set(events.map((event) => event.owner))].map((owner) => <span key={owner} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: ownerColors[ownerColor(owner)] }} />{owner}</span>)}</div>}</>}{selectedEvent && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#00121f]/75 p-4 backdrop-blur-sm"><article className="w-full max-w-md rounded-2xl border border-white/10 bg-[#002c47] p-5 shadow-2xl"><div className="flex justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-bny-teal">Meeting</p><h3 className="mt-2 text-lg font-semibold text-bny-paper">{selectedEvent.title}</h3></div><button type="button" onClick={() => setSelectedEvent(null)} className="text-bny-paper/60 hover:text-bny-paper"><X className="h-5 w-5" /></button></div><p className="mt-4 text-sm text-bny-paper/75">{formatDate(selectedEvent.start)} · {formatTime(selectedEvent.start)} – {formatTime(selectedEvent.end)}</p>{showOwner && <p className="mt-2 text-sm text-bny-paper/70">BNY owner: {selectedEvent.owner}</p>}<div className="mt-4 border-t border-white/10 pt-4"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">External attendees</p><div className="mt-2 flex flex-wrap gap-2">{selectedEvent.externalAttendees.map((email) => <span key={email} className="rounded-full border border-bny-gold/30 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{email}</span>)}</div></div></article></div>}</section>;
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

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadClientCsv(clients: ClientGroup[], directory: ClientDirectory, filename: string) {
  const header = ['Client', 'Aliases', 'Client contacts', 'BNY team', 'Next conversation', 'Upcoming meetings'];
  const rows = clients.map((client) => {
    const profile = directory[client.domain];
    const next = client.events[0];
    return [profile?.name || client.domain, (profile?.aliases ?? []).join('; '), [...client.contacts].join('; '), [...client.owners].join('; '), `${formatDate(next.start)} ${formatTime(next.start)} — ${next.title}`, String(client.events.length)];
  });
  const blob = new Blob([[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function EditableClientTracker({ events, directory, onDirectoryChange, filename }: { events: CalendarEvent[]; directory: ClientDirectory; onDirectoryChange: (domain: string, value: ClientProfile) => void; filename: string }) {
  const clients = useMemo(() => {
    const grouped = new Map<string, ClientGroup>();
    events.forEach((event) => event.externalAttendees.forEach((email) => {
      const domain = email.split('@')[1]?.toLowerCase() || email.toLowerCase();
      const client = grouped.get(domain) ?? { domain, contacts: new Set<string>(), owners: new Set<string>(), events: [] };
      client.contacts.add(email);
      client.owners.add(event.owner);
      if (!client.events.some((meeting) => meeting.id === event.id)) client.events.push(event);
      grouped.set(domain, client);
    }));
    return [...grouped.values()].map((client) => ({ ...client, events: client.events.sort((a, b) => a.start.getTime() - b.start.getTime()) })).sort((a, b) => a.events[0].start.getTime() - b.events[0].start.getTime());
  }, [events]);

  return <ClientTrackerDirectoryV2 clients={clients} directory={directory} onDirectoryChange={onDirectoryChange} filename={filename} />;

  if (!clients.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><UsersRound className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No client relationships found</p><p className="mt-1 text-xs text-bny-paper/55">Upload a calendar or expand the selected date range.</p></div>;
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#002c47]/65"><div className="flex items-center justify-between border-b border-white/10 px-5 py-3"><p className="text-xs text-bny-paper/55">Client names and aliases are saved in this browser.</p><button type="button" onClick={() => downloadClientCsv(clients, directory, filename)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-bny-paper/75 transition hover:border-bny-teal/50 hover:text-bny-teal"><Download className="h-3.5 w-3.5" /> Export CSV</button></div><div className="hidden grid-cols-[minmax(130px,.8fr)_minmax(170px,1.25fr)_minmax(115px,.8fr)_minmax(145px,1fr)_100px] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[.16em] text-bny-paper/45 lg:grid"><span>Client</span><span>Client contacts</span><span>BNY team</span><span>Next conversation</span><span>Upcoming</span></div><div className="divide-y divide-white/10">{clients.map((client) => { const profile = directory[client.domain] ?? { name: client.domain.replace(/\.[^.]+$/, ''), aliases: [] }; const next = client.events[0]; return <article key={client.domain} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(130px,.8fr)_minmax(170px,1.25fr)_minmax(115px,.8fr)_minmax(145px,1fr)_100px] lg:items-start"><div className="min-w-0"><label className="text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Client name<input value={profile.name} onChange={(event) => onDirectoryChange(client.domain, { ...profile, name: event.target.value })} className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/45 px-2.5 py-2 text-sm font-semibold normal-case tracking-normal text-bny-paper outline-none focus:border-bny-teal" /></label><label className="mt-2 block text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Aliases<input value={profile.aliases.join(', ')} onChange={(event) => onDirectoryChange(client.domain, { ...profile, aliases: event.target.value.split(',').map((alias) => alias.trim()).filter(Boolean) })} placeholder="e.g. Acme, ACME Capital" className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/45 px-2.5 py-2 text-xs normal-case tracking-normal text-bny-paper outline-none placeholder:text-bny-paper/30 focus:border-bny-teal" /></label></div><div className="min-w-0"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Client contacts</p><div className="flex flex-wrap gap-1.5">{[...client.contacts].map((contact) => <span key={contact} className="max-w-full break-all rounded-full border border-bny-gold/35 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{contact}</span>)}</div></div><div className="min-w-0 text-sm text-bny-paper/75"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">BNY team</p><p className="break-words">{[...client.owners].join(', ')}</p></div><div className="min-w-0"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Next conversation</p><p className="text-sm font-medium text-bny-paper">{formatDate(next.start)}</p><p className="mt-1 break-words text-xs leading-5 text-bny-teal">{formatTime(next.start)} · {next.title}</p></div><div><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Upcoming</p><span className="inline-flex whitespace-nowrap rounded-full bg-bny-teal/15 px-2.5 py-1 text-xs font-semibold text-bny-teal">{client.events.length} meeting{client.events.length === 1 ? '' : 's'}</span></div></article>; })}</div></div>;
}

function ClientIdentity({ domain, profile, onSave }: { domain: string; profile: { name: string; aliases: string[] }; onSave: (profile: { name: string; aliases: string[] }) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [aliases, setAliases] = useState(profile.aliases.join(', '));
  useEffect(() => { if (!editing) { setName(profile.name); setAliases(profile.aliases.join(', ')); } }, [editing, profile]);
  if (editing) return <div className="min-w-0 rounded-xl border border-bny-teal/30 bg-bny-deep/35 p-3"><label className="block text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Client name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/60 px-2.5 py-2 text-sm font-semibold normal-case tracking-normal text-bny-paper outline-none focus:border-bny-teal" /></label><label className="mt-2 block text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Aliases<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="e.g. Acme, ACME Capital" className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/60 px-2.5 py-2 text-xs normal-case tracking-normal text-bny-paper outline-none placeholder:text-bny-paper/30 focus:border-bny-teal" /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => { onSave({ name: name.trim() || domain.replace(/\.[^.]+$/, ''), aliases: aliases.split(',').map((alias) => alias.trim()).filter(Boolean) }); setEditing(false); }} className="rounded-lg bg-bny-teal px-2.5 py-1.5 text-xs font-semibold text-bny-deep">Save</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg px-2.5 py-1.5 text-xs text-bny-paper/60 hover:text-bny-paper">Cancel</button></div></div>;
  return <div className="min-w-0"><div className="flex items-start justify-between gap-2"><div><p className="break-words font-semibold text-bny-paper">{profile.name}</p>{profile.aliases.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{profile.aliases.map((alias) => <span key={alias} className="rounded-full bg-white/[.07] px-2 py-0.5 text-[11px] text-bny-paper/60">{alias}</span>)}</div>}</div><button type="button" onClick={() => setEditing(true)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-bny-paper/60 transition hover:border-bny-teal/50 hover:text-bny-teal"><Pencil className="h-3 w-3" /> Edit</button></div></div>;
}

function ClientTrackerDirectory({ clients, directory, onDirectoryChange, filename }: { clients: ClientGroup[]; directory: ClientDirectory; onDirectoryChange: (domain: string, value: { name: string; aliases: string[] }) => void; filename: string }) {
  if (!clients.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><UsersRound className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No client relationships found</p><p className="mt-1 text-xs text-bny-paper/55">Upload a calendar or expand the selected date range.</p></div>;
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#002c47]/65"><div className="flex items-center justify-between border-b border-white/10 px-5 py-3"><p className="text-xs text-bny-paper/55">Select Edit to change a client name or aliases.</p><button type="button" onClick={() => downloadClientCsv(clients, directory, filename)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-bny-paper/75 transition hover:border-bny-teal/50 hover:text-bny-teal"><Download className="h-3.5 w-3.5" /> Export CSV</button></div><div className="hidden grid-cols-[minmax(140px,.9fr)_minmax(170px,1.25fr)_minmax(115px,.8fr)_minmax(145px,1fr)_100px] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[.16em] text-bny-paper/45 lg:grid"><span>Client</span><span>Client contacts</span><span>BNY team</span><span>Next conversation</span><span>Upcoming</span></div><div className="divide-y divide-white/10">{clients.map((client) => { const profile = directory[client.domain] ?? { name: client.domain.replace(/\.[^.]+$/, ''), aliases: [] }; const next = client.events[0]; return <article key={client.domain} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(140px,.9fr)_minmax(170px,1.25fr)_minmax(115px,.8fr)_minmax(145px,1fr)_100px] lg:items-start"><ClientIdentity domain={client.domain} profile={profile} onSave={(value) => onDirectoryChange(client.domain, value)} /><div className="min-w-0"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Client contacts</p><div className="flex flex-wrap gap-1.5">{[...client.contacts].map((contact) => <span key={contact} className="max-w-full break-all rounded-full border border-bny-gold/35 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{contact}</span>)}</div></div><div className="min-w-0 text-sm text-bny-paper/75"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">BNY team</p><p className="break-words">{[...client.owners].join(', ')}</p></div><div className="min-w-0"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Next conversation</p><p className="text-sm font-medium text-bny-paper">{formatDate(next.start)}</p><p className="mt-1 break-words text-xs leading-5 text-bny-teal">{formatTime(next.start)} · {next.title}</p></div><div><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45 lg:hidden">Upcoming</p><span className="inline-flex whitespace-nowrap rounded-full bg-bny-teal/15 px-2.5 py-1 text-xs font-semibold text-bny-teal">{client.events.length} meeting{client.events.length === 1 ? '' : 's'}</span></div></article>; })}</div></div>;
}

function ClientProfileCard({ domain, profile, onSave }: { domain: string; profile: ClientProfile; onSave: (value: ClientProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  useEffect(() => { if (!editing) setDraft(profile); }, [editing, profile]);
  if (editing) return <div className="rounded-xl border border-bny-teal/30 bg-bny-deep/35 p-3"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Client name" className="w-full rounded-lg border border-white/10 bg-bny-deep/60 px-2.5 py-2 text-sm font-semibold text-bny-paper outline-none focus:border-bny-teal" /><input value={draft.aliases.join(', ')} onChange={(event) => setDraft({ ...draft, aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Aliases" aria-label="Aliases" className="mt-2 w-full rounded-lg border border-white/10 bg-bny-deep/60 px-2.5 py-2 text-xs text-bny-paper outline-none focus:border-bny-teal" /><input value={draft.nextStep ?? ''} onChange={(event) => setDraft({ ...draft, nextStep: event.target.value })} placeholder="Next step" aria-label="Next step" className="mt-2 w-full rounded-lg border border-white/10 bg-bny-deep/60 px-2.5 py-2 text-xs text-bny-paper outline-none focus:border-bny-teal" /><div className="mt-3 flex gap-2"><button type="button" onClick={() => { onSave({ ...draft, name: draft.name.trim() || domain.replace(/\.[^.]+$/, '') }); setEditing(false); }} className="rounded-lg bg-bny-teal px-2.5 py-1.5 text-xs font-semibold text-bny-deep">Save</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg px-2.5 py-1.5 text-xs text-bny-paper/60">Cancel</button></div></div>;
  return <div><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-bny-paper">{profile.name}</p>{profile.aliases.length > 0 && <p className="mt-1 text-xs text-bny-paper/45">{profile.aliases.join(' · ')}</p>}</div><button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-bny-paper/60 hover:text-bny-teal"><Pencil className="h-3 w-3" /> Edit</button></div></div>;
}

function NextStepCell({ profile, onSave }: { profile: ClientProfile; onSave: (value: ClientProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.nextStep ?? '');
  useEffect(() => { if (!editing) setDraft(profile.nextStep ?? ''); }, [editing, profile.nextStep]);
  if (editing) return <div onClick={(event) => event.stopPropagation()}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} autoFocus placeholder="Add next step" aria-label="Next step" className="w-full resize-none rounded-lg border border-white/10 bg-bny-deep/60 px-2.5 py-2 text-xs leading-5 text-bny-paper outline-none focus:border-bny-teal" /><div className="mt-2 flex gap-2"><button type="button" onClick={() => { onSave({ ...profile, nextStep: draft.trim() }); setEditing(false); }} className="rounded-lg bg-bny-teal px-2.5 py-1.5 text-[11px] font-semibold text-bny-deep">Save</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg px-2 py-1.5 text-[11px] text-bny-paper/60">Cancel</button></div></div>;
  return <div onClick={(event) => event.stopPropagation()} className="group flex min-w-0 items-start gap-2"><p className="min-w-0 flex-1 break-words text-sm leading-5 text-bny-paper/70">{profile.nextStep || '—'}</p><button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-bny-paper/60 opacity-100 transition hover:text-bny-teal lg:opacity-0 lg:group-hover:opacity-100"><Pencil className="h-3 w-3" /><span className="sr-only">Edit next step</span></button></div>;
}

function ClientDetailModal({ client, profile, onClose }: { client: ClientGroup; profile: ClientProfile; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#00121f]/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${profile.name} client details`}><div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/10 bg-[#002c47] shadow-2xl"><div className="flex items-start justify-between border-b border-white/10 p-6"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-bny-teal">Client relationship</p><h2 className="mt-1 text-2xl font-semibold text-bny-paper">{profile.name}</h2>{profile.aliases.length > 0 && <p className="mt-2 text-sm text-bny-paper/55">{profile.aliases.join(' · ')}</p>}</div><button type="button" onClick={onClose} className="rounded-lg p-2 text-bny-paper/60 hover:bg-white/10"><X className="h-5 w-5" /></button></div><div className="grid gap-6 p-6 lg:grid-cols-[1fr_2fr]"><aside className="space-y-5"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Next step</p><p className="mt-2 text-sm leading-6 text-bny-paper/80">{profile.nextStep || 'No next step recorded.'}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">BNY team</p><div className="mt-2 flex flex-wrap gap-2">{[...client.owners].map((owner) => <span key={owner} className="rounded-full bg-white/[.07] px-2.5 py-1 text-xs text-bny-paper/75">{owner}</span>)}</div></div><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Client contacts</p><div className="mt-2 flex flex-wrap gap-2">{[...client.contacts].map((contact) => <span key={contact} className="rounded-full border border-bny-gold/30 bg-bny-gold/10 px-2.5 py-1 text-xs text-[#f0d89a]">{contact}</span>)}</div></div></aside><section><p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">All upcoming meetings · {client.events.length}</p><div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-b border-white/10 text-[10px] uppercase tracking-[.14em] text-bny-paper/45"><tr><th className="px-4 py-3">Date & time</th><th className="px-4 py-3">Meeting</th><th className="px-4 py-3">BNY owner</th><th className="px-4 py-3">External attendees</th></tr></thead><tbody className="divide-y divide-white/10">{client.events.map((event) => <tr key={event.id}><td className="px-4 py-3 text-bny-paper/75"><p>{formatDate(event.start)}</p><p className="mt-1 text-xs text-bny-teal">{formatTime(event.start)} – {formatTime(event.end)}</p></td><td className="px-4 py-3 font-medium text-bny-paper">{event.title}</td><td className="px-4 py-3 text-bny-paper/70">{event.owner}</td><td className="px-4 py-3 text-xs text-[#f0d89a]">{event.externalAttendees.join(', ')}</td></tr>)}</tbody></table></div></section></div></div></div>;
}

function ClientTrackerDirectoryV2({ clients, directory, onDirectoryChange, filename }: { clients: ClientGroup[]; directory: ClientDirectory; onDirectoryChange: (domain: string, value: ClientProfile) => void; filename: string }) {
  const [selected, setSelected] = useState<ClientGroup | null>(null);
  if (!clients.length) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-12 text-center"><UsersRound className="mx-auto h-7 w-7 text-bny-teal/60" /><p className="mt-3 text-sm font-semibold text-bny-paper">No client relationships found</p></div>;
  const profileFor = (client: ClientGroup): ClientProfile => directory[client.domain] ?? { name: client.domain.replace(/\.[^.]+$/, ''), aliases: [], nextStep: '' };
  return <><div className="max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-[#002c47]/65"><div className="min-w-[960px]"><div className="flex items-center justify-between border-b border-white/10 px-5 py-3"><p className="text-xs text-bny-paper/55">Select a row to view the relationship and meeting history.</p><button type="button" onClick={() => downloadClientCsv(clients, directory, filename)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-bny-paper/75 hover:text-bny-teal"><Download className="h-3.5 w-3.5" /> Export CSV</button></div><div className="grid grid-cols-[minmax(150px,.85fr)_minmax(150px,1fr)_minmax(110px,.65fr)_minmax(145px,.9fr)_minmax(140px,.9fr)_90px] gap-4 border-b border-white/10 px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45"><span>Client</span><span>Contacts</span><span>BNY team</span><span>Next conversation</span><span>Next step</span><span>Upcoming</span></div><div className="divide-y divide-white/10">{clients.map((client) => { const profile = profileFor(client); const next = client.events[0]; return <article key={client.domain} onClick={() => setSelected(client)} className="grid cursor-pointer grid-cols-[minmax(150px,.85fr)_minmax(150px,1fr)_minmax(110px,.65fr)_minmax(145px,.9fr)_minmax(140px,.9fr)_90px] gap-4 px-5 py-5 transition hover:bg-white/[.035]"><div onClick={(event) => event.stopPropagation()}><ClientProfileCard domain={client.domain} profile={profile} onSave={(value) => onDirectoryChange(client.domain, value)} /></div><div className="flex flex-wrap content-start gap-1.5">{[...client.contacts].slice(0, 3).map((contact) => <span key={contact} className="max-w-full break-all rounded-full border border-bny-gold/30 bg-bny-gold/10 px-2 py-1 text-xs text-[#f0d89a]">{contact}</span>)}{client.contacts.size > 3 && <span className="text-xs text-bny-paper/50">+{client.contacts.size - 3}</span>}</div><p className="text-sm text-bny-paper/75">{[...client.owners].join(', ')}</p><div><p className="text-sm font-medium text-bny-paper">{formatDate(next.start)}</p><p className="mt-1 text-xs text-bny-teal">{formatTime(next.start)} · {next.title}</p></div><NextStepCell profile={profile} onSave={(value) => onDirectoryChange(client.domain, value)} /><span className="h-fit whitespace-nowrap rounded-full bg-bny-teal/15 px-2.5 py-1 text-xs font-semibold text-bny-teal">{client.events.length} meeting{client.events.length === 1 ? '' : 's'}</span></article>; })}</div></div></div>{selected && <ClientDetailModal client={selected} profile={profileFor(selected)} onClose={() => setSelected(null)} />}</>;
}

function CalendarControls({
  rangeDays,
  search,
  onRangeChange,
  onSearchChange,
  onShare,
  shareStatus,
  teamOwners,
  selectedTeamOwner,
  onTeamOwnerChange,
}: {
  rangeDays: 7 | 30 | 90;
  search: string;
  onRangeChange: (days: 7 | 30 | 90) => void;
  onSearchChange: (value: string) => void;
  onShare: () => void;
  shareStatus: string;
  teamOwners?: string[];
  selectedTeamOwner?: string;
  onTeamOwnerChange?: (owner: string) => void;
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
    {teamOwners && teamOwners.length > 0 && <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-bny-deep/40 px-3 py-2 text-xs text-bny-paper/55"><span className="whitespace-nowrap">Team member</span><select value={selectedTeamOwner} onChange={(event) => onTeamOwnerChange?.(event.target.value)} className="min-w-0 bg-transparent text-xs font-semibold text-bny-paper outline-none"><option value="all" className="bg-bny-deep">All members</option>{teamOwners.map((owner) => <option key={owner} value={owner} className="bg-bny-deep">{owner}</option>)}</select></label>}
  </div>;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function ChatResponse({ content }: { content: string }) {
  const lines = content.split('\n').filter((line) => line.trim());
  const rows = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const rendered: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const headings = rows(line);
      const body: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) { body.push(rows(lines[index])); index += 1; }
      index -= 1;
      rendered.push(<div key={`table-${index}`} className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[310px] text-left text-xs"><thead className="bg-white/[.06] text-bny-paper/65"><tr>{headings.map((heading) => <th key={heading} className="px-3 py-2 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-white/10">{body.map((row, rowIndex) => <tr key={rowIndex}>{headings.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top leading-5 text-bny-paper/80">{row[cellIndex] ?? ''}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) rendered.push(<p key={index} className="font-semibold text-bny-paper">{line.replace(/^#{1,3}\s/, '')}</p>);
    else if (/^[-*]\s/.test(line)) rendered.push(<div key={index} className="flex gap-2"><span className="text-bny-teal">•</span><span>{line.replace(/^[-*]\s/, '')}</span></div>);
    else if (/^\d+\.\s/.test(line)) rendered.push(<div key={index} className="flex gap-2"><span className="text-bny-teal">{line.match(/^\d+/)?.[0]}.</span><span>{line.replace(/^\d+\.\s/, '')}</span></div>);
    else rendered.push(<p key={index}>{line}</p>);
  }
  return <div className="space-y-2">{rendered}</div>;
}

function CalendarChat({ personalEvents, teamEvents, personalUploaded, isOpen, onToggle }: { personalEvents: CalendarEvent[]; teamEvents: CalendarEvent[]; personalUploaded: boolean; isOpen: boolean; onToggle: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Ask me about upcoming meetings, clients, or team coverage.' }]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [scope, setScope] = useState<'personal' | 'team' | 'both'>(personalUploaded ? 'both' : 'team');
  const calendarContext = useMemo(() => [
    ...personalEvents.map((event) => ({ scope: 'My Calendar' as const, title: event.title, start: event.start.toISOString(), end: event.end.toISOString(), externalAttendees: event.externalAttendees })),
    ...teamEvents.map((event) => ({ scope: 'Team Calendars' as const, title: event.title, start: event.start.toISOString(), end: event.end.toISOString(), owner: event.owner, externalAttendees: event.externalAttendees })),
  ].slice(0, 160), [personalEvents, teamEvents]);
  const scopedContext = useMemo(() => calendarContext.filter((event) => scope === 'both' || (scope === 'personal' ? event.scope === 'My Calendar' : event.scope === 'Team Calendars')), [calendarContext, scope]);

  useEffect(() => {
    if (!personalUploaded && scope === 'personal') setScope('team');
  }, [personalUploaded, scope]);

  const ask = useCallback(async (question: string) => {
    const content = question.trim();
    if (!content || sending) return;
    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    try {
      const response = await fetch('/api/calendar-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: nextMessages.slice(1), calendarContext: scopedContext, scope, personalCalendarUploaded: personalUploaded }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Calendar chat is unavailable.');
      setMessages((current) => [...current, { role: 'assistant', content: data.answer }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error instanceof Error ? error.message : 'Calendar chat is unavailable.' }]);
    } finally {
      setSending(false);
    }
  }, [messages, personalUploaded, scope, scopedContext, sending]);

  return <><button type="button" onClick={onToggle} className={`fixed right-0 top-28 z-30 hidden items-center gap-2 rounded-l-xl border border-r-0 border-white/15 bg-[#002c47] px-3 py-3 text-xs font-semibold text-bny-teal shadow-xl transition xl:flex ${isOpen ? 'translate-x-full' : 'translate-x-0'}`} aria-label="Open calendar chat"><PanelRightOpen className="h-4 w-4" /> Calendar chat</button><aside className={`fixed bottom-20 left-3 right-3 top-3 z-40 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#001f35] shadow-2xl transition-transform duration-300 xl:bottom-4 xl:left-auto xl:right-4 xl:top-4 xl:w-[min(380px,calc(100vw-2rem))] ${isOpen ? 'translate-y-0 xl:translate-x-0' : 'translate-y-[calc(100%+6rem)] xl:translate-x-[calc(100%+2rem)]'}`} aria-hidden={!isOpen}>
    <div className="border-b border-white/10 px-5 py-4"><div className="flex items-start justify-between"><div><div className="flex items-center gap-2 text-bny-teal"><MessageCircle className="h-5 w-5" /><h2 className="font-semibold">Ask your calendar</h2></div><p className="mt-1 text-xs leading-5 text-bny-paper/55">Answers use only the selected calendar source.</p></div><button type="button" onClick={onToggle} className="rounded-lg p-2 text-bny-paper/55 transition hover:bg-white/10 hover:text-bny-teal" aria-label="Collapse calendar chat"><PanelRightClose className="h-4 w-4" /></button></div><div className="mt-3 flex rounded-xl bg-bny-deep/60 p-1">{([{ key: 'personal', label: 'My calendar', disabled: !personalUploaded }, { key: 'team', label: 'Team', disabled: !teamEvents.length }, { key: 'both', label: 'Both', disabled: !personalUploaded && !teamEvents.length }] as const).map((option) => <button key={option.key} type="button" disabled={option.disabled} onClick={() => setScope(option.key)} className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${scope === option.key ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'} disabled:cursor-not-allowed disabled:opacity-30`}>{option.label}</button>)}</div>{!personalUploaded && <p className="mt-2 text-[11px] text-bny-paper/45">No personal calendar is uploaded. Team results are not presented as your meetings.</p>}</div>
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`max-w-[92%] rounded-2xl px-3.5 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-bny-teal text-bny-deep' : 'bg-white/[.07] text-bny-paper/80'}`}>{message.role === 'assistant' ? <ChatResponse content={message.content} /> : message.content}</div>)}{sending && <div className="w-fit rounded-2xl bg-white/[.07] px-3.5 py-3 text-sm text-bny-paper/60">Reviewing your calendar...</div>}</div>
    <div className="border-t border-white/10 p-4"><div className="mb-3 flex flex-wrap gap-2">{['Who am I meeting next week?', 'Which clients have the most meetings?', 'Summarize team client coverage.'].map((question) => <button key={question} type="button" disabled={sending} onClick={() => void ask(question)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-bny-paper/65 transition hover:border-bny-teal/50 hover:text-bny-teal disabled:opacity-50">{question}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void ask(draft); }} className="flex items-end gap-2 rounded-xl border border-white/10 bg-bny-deep/50 p-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Ask about your calendar…" className="min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-bny-paper outline-none placeholder:text-bny-paper/35" /><button type="submit" disabled={!draft.trim() || sending} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bny-teal text-bny-deep transition hover:bg-[#8adbe2] disabled:cursor-not-allowed disabled:opacity-45"><Send className="h-4 w-4" /><span className="sr-only">Send message</span></button></form></div>
  </aside><button type="button" onClick={onToggle} className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-bny-teal px-4 py-3 text-sm font-semibold text-bny-deep shadow-xl xl:hidden"><MessageCircle className="h-4 w-4" /> {isOpen ? 'Hide chat' : 'Ask your calendar'}</button></>;
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
  const [clientDirectory, setClientDirectory] = useState<ClientDirectory>({});
  const [shareStatus, setShareStatus] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const [selectedTeamOwner, setSelectedTeamOwner] = useState('all');
  const persist = useCallback((next: PersistedCalendars, syncTeam = false) => {
    saveCalendars(next);
    if (!syncTeam) return;
    void saveSharedTeamCalendars(next.team).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSharedClientProfiles().then((profiles) => {
      if (!cancelled && profiles && Object.keys(profiles).length > 0) {
        setClientDirectory(profiles);
        window.localStorage.setItem(CLIENT_DIRECTORY_KEY, JSON.stringify(profiles));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
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

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CLIENT_DIRECTORY_KEY);
      if (saved) setClientDirectory(JSON.parse(saved) as ClientDirectory);
    } catch { /* Start with an empty client directory when storage is invalid. */ }
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const range = Number(params.get('range'));
    const view = params.get('view');
    if (tab === 'personal' || tab === 'team') setActiveTab(tab);
    if (range === 7 || range === 30 || range === 90) setRangeDays(range);
    if (params.get('search')) setSearch(params.get('search') ?? '');
    if (view === 'meetings' || view === 'tracker') {
      if (tab === 'team') setTeamView(view);
      else setPersonalView(view);
    }
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
  const allTeamEvents = useMemo(() => filterEvents(team.flatMap((calendar) => calendar.events)), [filterEvents, team]);
  const teamOwners = useMemo(() => [...new Set(allTeamEvents.map((event) => event.owner).filter(Boolean))].sort(), [allTeamEvents]);
  const teamEvents = useMemo(() => selectedTeamOwner === 'all' ? allTeamEvents : allTeamEvents.filter((event) => event.owner === selectedTeamOwner), [allTeamEvents, selectedTeamOwner]);

  useEffect(() => {
    if (selectedTeamOwner !== 'all' && !teamOwners.includes(selectedTeamOwner)) setSelectedTeamOwner('all');
  }, [selectedTeamOwner, teamOwners]);

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
  const updateClientDirectory = useCallback((domain: string, value: ClientProfile) => {
    setClientDirectory((current) => {
      const next = { ...current, [domain]: value };
      window.localStorage.setItem(CLIENT_DIRECTORY_KEY, JSON.stringify(next));
      void saveSharedClientProfiles(next).catch(() => undefined);
      return next;
    });
  }, []);
  const shareView = useCallback(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeTab);
    url.searchParams.set('range', String(rangeDays));
    url.searchParams.set('view', activeTab === 'team' ? teamView : personalView);
    if (search.trim()) url.searchParams.set('search', search.trim());
    else url.searchParams.delete('search');
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus('Link copied');
    } catch {
      window.prompt('Copy this shareable view link:', url.toString());
      setShareStatus('Link ready');
    }
    window.setTimeout(() => setShareStatus(''), 2500);
  }, [activeTab, personalView, rangeDays, search, teamView]);

  return <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
    <div className={`mx-auto max-w-[1800px] transition-all ${chatOpen ? 'xl:mr-[420px]' : ''}`}>
      <header className="flex flex-col gap-6 border-b border-white/10 pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4"><div className="flex h-14 w-20 items-center justify-center rounded-xl border border-white/10 bg-white/[.06] px-2"><Image src="/bny-logo.svg" alt="BNY" width={160} height={48} className="h-auto w-full" priority /></div><h1 className="text-xl font-semibold tracking-tight text-bny-paper sm:text-2xl">Client Meeting Intelligence</h1></div>
      </header>

      <section className="mt-7"><div className="flex gap-2 border-b border-white/10" role="tablist" aria-label="Calendar views">
        {([{ key: 'personal', label: 'My Calendar', icon: CalendarDays }, { key: 'team', label: 'Team Calendars', icon: UsersRound }] as const).map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${activeTab === key ? 'border-bny-teal text-bny-teal' : 'border-transparent text-bny-paper/55 hover:text-bny-paper'}`}><Icon className="h-4 w-4" />{label}</button>)}
      </div>

      <CalendarControls rangeDays={rangeDays} search={search} onRangeChange={setRangeDays} onSearchChange={setSearch} onShare={() => void shareView()} shareStatus={shareStatus} teamOwners={activeTab === 'team' && teamView === 'tracker' ? teamOwners : undefined} selectedTeamOwner={selectedTeamOwner} onTeamOwnerChange={setSelectedTeamOwner} />

      {errors.length > 0 && <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div>{errors.map((error) => <p key={error}>{error}</p>)}</div><button type="button" onClick={() => setErrors([])} className="ml-auto"><X className="h-4 w-4" /></button></div>}

      {activeTab === 'personal' ? <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside><div className="rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><div className="flex items-center gap-2 text-bny-teal"><Globe2 className="h-5 w-5" /><h2 className="font-semibold">Personal calendar</h2></div><div className="mt-5"><UploadZone onUpload={uploadPersonal} /></div>{personal && <div className="mt-4 flex items-center justify-between rounded-xl bg-white/[.05] p-3 text-xs"><span className="max-w-56 truncate text-bny-paper/70">{personal.name}</span><button type="button" onClick={() => saveCalendars({ ...readStoredCalendars(), personal: null })} className="text-bny-teal hover:text-white">Remove</button></div>}</div></aside>
        <div className="min-w-0"><div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-bny-teal">Upcoming meetings</p><h2 className="mt-1 text-xl font-semibold">{personalView === 'tracker' ? 'My client meeting tracker' : 'My external client meetings'}</h2></div><div className="flex items-center gap-3"><div className="flex rounded-xl border border-white/10 bg-bny-deep/50 p-1"><button type="button" onClick={() => setPersonalView('meetings')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${personalView === 'meetings' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Meetings</button><button type="button" onClick={() => setPersonalView('tracker')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${personalView === 'tracker' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Client tracker</button></div>{personal && <span className="hidden items-center gap-1.5 text-xs text-bny-paper/60 sm:flex"><CheckCircle2 className="h-4 w-4 text-bny-teal" /> Filter active</span>}</div></div>{personalView === 'tracker' ? <EditableClientTracker events={personalEvents} directory={clientDirectory} onDirectoryChange={updateClientDirectory} filename="my-client-tracker.csv" /> : <EventList events={personalEvents} />}</div>
      </div> : <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside><div className="rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><div className="flex items-center gap-2 text-bny-teal"><UsersRound className="h-5 w-5" /><h2 className="font-semibold">Team calendar files</h2></div><div className="mt-5"><UploadZone multiple onUpload={uploadTeam} /></div>{team.length > 0 && <div className="mt-4 space-y-3">{team.map((calendar) => <div key={calendar.id} className="rounded-xl bg-white/[.05] p-3 text-xs"><p className="mb-2 truncate text-bny-paper/50">{calendar.name}</p><label className="block text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Calendar owner<input value={calendar.owner} onChange={(event) => updateTeamOwner(calendar.id, event.target.value)} placeholder="Team member name" className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/50 px-2.5 py-2 text-sm normal-case tracking-normal text-bny-paper outline-none placeholder:text-bny-paper/30 focus:border-bny-teal" /></label><button type="button" onClick={() => { const current = readStoredCalendars(); persist({ ...current, team: current.team.filter((item) => item.id !== calendar.id) }, true); }} className="mt-3 text-bny-teal hover:text-white">Remove</button></div>)}</div>}</div></aside>
        <div className="min-w-0"><div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-bny-teal">Team overview</p><h2 className="mt-1 text-xl font-semibold">{teamView === 'tracker' ? 'Client meeting tracker' : 'All external client meetings'}</h2></div><div className="flex items-center gap-3"><div className="flex rounded-xl border border-white/10 bg-bny-deep/50 p-1"><button type="button" onClick={() => setTeamView('meetings')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${teamView === 'meetings' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Meetings</button><button type="button" onClick={() => setTeamView('tracker')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${teamView === 'tracker' ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/60 hover:text-bny-paper'}`}>Client tracker</button></div><span className="hidden items-center gap-1.5 text-xs text-bny-paper/60 sm:flex"><Clock3 className="h-4 w-4 text-bny-teal" /> Chronological</span></div></div>{teamView === 'tracker' ? <EditableClientTracker events={teamEvents} directory={clientDirectory} onDirectoryChange={updateClientDirectory} filename="team-client-tracker.csv" /> : <EventList events={teamEvents} showOwner />}</div>
      </div>}</section>
      {activeTab === 'personal' && <div className="mt-6"><InboxActionCenter /></div>}

      <footer className="mt-10 flex items-center justify-between border-t border-white/10 py-5 text-xs text-bny-paper/40"><span>Client Meeting Intelligence</span><span className="flex items-center gap-1">Built for calendar visibility <ChevronRight className="h-3 w-3" /></span></footer>
    <CalendarChat personalEvents={personalEvents} teamEvents={teamEvents} personalUploaded={Boolean(personal)} isOpen={chatOpen} onToggle={() => setChatOpen((open) => !open)} />
    </div>
  </main>;
}
