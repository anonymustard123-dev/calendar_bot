'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ICAL from 'ical.js';
import Image from 'next/image';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileUp,
  Globe2,
  ShieldCheck,
  UploadCloud,
  UsersRound,
  X,
} from 'lucide-react';

type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  externalAttendees: string[];
  owner: string;
};

type UploadedCalendar = {
  id: string;
  name: string;
  owner: string;
  events: CalendarEvent[];
};

type UploadResult = { calendars: UploadedCalendar[]; errors: string[] };

type StoredCalendar = Omit<UploadedCalendar, 'events'> & {
  events: Array<Omit<CalendarEvent, 'start' | 'end'> & { start: string; end: string }>;
};

const STORAGE_KEY = 'bny-client-meeting-intelligence-v1';
const MAX_LOOKAHEAD_DAYS = 90;
type PersistedCalendars = { personal: UploadedCalendar | null; team: UploadedCalendar[] };
const EMPTY_PERSISTED_CALENDARS: PersistedCalendars = { personal: null, team: [] };
const calendarListeners = new Set<() => void>();
let storedCalendars: PersistedCalendars | undefined;

const acceptedFile = (file: File) => /\.(ics|txt)$/i.test(file.name);

function cleanEmail(value: string) {
  return value.replace(/^mailto:/i, '').trim();
}

function friendlyOwner(filename: string) {
  return filename.replace(/\.(ics|txt)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Team member';
}

function externalAttendeesFor(event: ICAL.Event) {
  return event.component
    .getAllProperties('attendee')
    .map((property) => cleanEmail(String(property.getFirstValue() ?? '')))
    .filter((email) => email && !email.toLowerCase().includes('@bny.com'));
}

function toClientMeeting(event: ICAL.Event, start: Date, end: Date, owner: string, suffix: string): CalendarEvent | null {
  const externalAttendees = externalAttendeesFor(event);
  if (externalAttendees.length === 0) return null;

  return {
    id: `${owner}-${event.uid || suffix}-${start.getTime()}`,
    title: event.summary || 'Untitled meeting',
    start,
    end,
    externalAttendees: [...new Set(externalAttendees)],
    owner,
  };
}

function parseCalendar(text: string, owner: string): CalendarEvent[] {
  const component = new ICAL.Component(ICAL.parse(text));
  const now = new Date();
  const lookahead = new Date(now);
  lookahead.setDate(lookahead.getDate() + MAX_LOOKAHEAD_DAYS);
  const records = component.getAllSubcomponents('vevent').map((vevent) => new ICAL.Event(vevent));
  const masters = records.filter((event) => !event.isRecurrenceException());

  records.filter((event) => event.isRecurrenceException()).forEach((exception) => {
    masters.find((event) => event.uid === exception.uid)?.relateException(exception);
  });

  return masters.flatMap((event, index) => {
    try {
      if (!event.isRecurring()) {
        const start = event.startDate?.toJSDate();
        const end = event.endDate?.toJSDate() ?? start;
        const clientMeeting = start && end && end >= now ? toClientMeeting(event, start, end, owner, String(index)) : null;
        return clientMeeting ? [clientMeeting] : [];
      }

      const occurrences: CalendarEvent[] = [];
      const iterator = event.iterator();
      let occurrence = iterator.next();
      while (occurrence) {
        const occurrenceStart = occurrence.toJSDate();
        if (occurrenceStart > lookahead) break;
        const details = event.getOccurrenceDetails(occurrence);
        const start = details.startDate.toJSDate();
        const end = details.endDate.toJSDate();
        if (end >= now) {
          const clientMeeting = toClientMeeting(details.item, start, end, owner, `${index}-${start.getTime()}`);
          if (clientMeeting) occurrences.push(clientMeeting);
        }
        occurrence = iterator.next();
      }
      return occurrences;
    } catch {
      return [];
    }
  });
}

function reviveCalendar(calendar: StoredCalendar): UploadedCalendar {
  const owner = calendar.owner || calendar.events[0]?.owner || friendlyOwner(calendar.name);
  return {
    ...calendar,
    owner,
    events: calendar.events.map((event) => ({ ...event, owner, start: new Date(event.start), end: new Date(event.end) })),
  };
}

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
    <div className="flex items-center gap-1 rounded-xl bg-bny-deep/70 p-1" aria-label="Date range">
      {([7, 30, 90] as const).map((days) => <button key={days} type="button" onClick={() => onRangeChange(days)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${rangeDays === days ? 'bg-bny-teal text-bny-deep' : 'text-bny-paper/65 hover:text-bny-paper'}`}>Next {days} days</button>)}
    </div>
    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-bny-deep/40 px-3 py-2 text-sm text-bny-paper/55 sm:w-72">
      <span className="sr-only">Search meetings</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
      <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search title or attendee" className="min-w-0 flex-1 bg-transparent text-sm text-bny-paper outline-none placeholder:text-bny-paper/35" />
    </label>
  </div>;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'personal' | 'team'>('personal');
  const persistedCalendars = useSyncExternalStore(subscribeToCalendars, readStoredCalendars, () => EMPTY_PERSISTED_CALENDARS);
  const { personal, team } = persistedCalendars;
  const [errors, setErrors] = useState<string[]>([]);
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [search, setSearch] = useState('');

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
    if (result.calendars[0]) saveCalendars({ ...readStoredCalendars(), personal: result.calendars[0] });
  }, []);
  const uploadTeam = useCallback(async (files: FileList | File[]) => {
    const result = await readCalendars(files);
    setErrors(result.errors);
    const current = readStoredCalendars();
    saveCalendars({ ...current, team: [...current.team, ...result.calendars.filter((next) => !current.team.some((existing) => existing.id === next.id))] });
  }, []);
  const updateTeamOwner = useCallback((id: string, owner: string) => {
    const current = readStoredCalendars();
    saveCalendars({ ...current, team: current.team.map((calendar) => calendar.id === id ? { ...calendar, owner, events: calendar.events.map((event) => ({ ...event, owner })) } : calendar) });
  }, []);

  return <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col gap-6 border-b border-white/10 pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4"><div className="flex h-14 w-20 items-center justify-center rounded-xl border border-white/10 bg-white/[.06] px-2"><Image src="/bny-logo.svg" alt="BNY" width={160} height={48} className="h-auto w-full" priority /></div><div><p className="text-[11px] font-bold uppercase tracking-[.22em] text-bny-teal">Workplace automation</p><h1 className="mt-1 text-xl font-semibold tracking-tight text-bny-paper sm:text-2xl">Client Meeting Intelligence</h1></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-bny-teal/20 bg-bny-teal/[.07] px-4 py-3 text-xs text-bny-paper/70"><ShieldCheck className="h-4 w-4 shrink-0 text-bny-teal" />Calendar data is processed locally</div>
      </header>

      <section className="mt-7"><div className="flex gap-2 border-b border-white/10" role="tablist" aria-label="Calendar views">
        {([{ key: 'personal', label: 'My Calendar', icon: CalendarDays }, { key: 'team', label: 'Team Calendars', icon: UsersRound }] as const).map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${activeTab === key ? 'border-bny-teal text-bny-teal' : 'border-transparent text-bny-paper/55 hover:text-bny-paper'}`}><Icon className="h-4 w-4" />{label}</button>)}
      </div>

      <CalendarControls rangeDays={rangeDays} search={search} onRangeChange={setRangeDays} onSearchChange={setSearch} />

      {errors.length > 0 && <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div>{errors.map((error) => <p key={error}>{error}</p>)}</div><button type="button" onClick={() => setErrors([])} className="ml-auto"><X className="h-4 w-4" /></button></div>}

      {activeTab === 'personal' ? <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside><div className="rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><div className="flex items-center gap-2 text-bny-teal"><Globe2 className="h-5 w-5" /><h2 className="font-semibold">Personal calendar</h2></div><p className="mt-2 text-sm leading-6 text-bny-paper/60">Upload an iCalendar export. Only meetings with an attendee outside <span className="text-bny-paper">@bny.com</span> are shown.</p><div className="mt-5"><UploadZone onUpload={uploadPersonal} /></div>{personal && <div className="mt-4 flex items-center justify-between rounded-xl bg-white/[.05] p-3 text-xs"><span className="max-w-56 truncate text-bny-paper/70">{personal.name}</span><button type="button" onClick={() => saveCalendars({ ...readStoredCalendars(), personal: null })} className="text-bny-teal hover:text-white">Remove</button></div>}</div></aside>
        <div><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-bny-teal">Upcoming meetings</p><h2 className="mt-1 text-xl font-semibold">My external client meetings</h2></div>{personal && <span className="hidden items-center gap-1.5 text-xs text-bny-paper/60 sm:flex"><CheckCircle2 className="h-4 w-4 text-bny-teal" /> Filter active</span>}</div><EventList events={personalEvents} /></div>
      </div> : <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside><div className="rounded-2xl border border-white/10 bg-[#001f35]/70 p-5"><div className="flex items-center gap-2 text-bny-teal"><UsersRound className="h-5 w-5" /><h2 className="font-semibold">Team calendar files</h2></div><p className="mt-2 text-sm leading-6 text-bny-paper/60">Add one or many calendar exports, then set a clear owner name for each combined calendar.</p><div className="mt-5"><UploadZone multiple onUpload={uploadTeam} /></div>{team.length > 0 && <div className="mt-4 space-y-3">{team.map((calendar) => <div key={calendar.id} className="rounded-xl bg-white/[.05] p-3 text-xs"><p className="mb-2 truncate text-bny-paper/50">{calendar.name}</p><label className="block text-[10px] font-bold uppercase tracking-[.14em] text-bny-paper/45">Calendar owner<input value={calendar.owner} onChange={(event) => updateTeamOwner(calendar.id, event.target.value)} placeholder="Team member name" className="mt-1.5 w-full rounded-lg border border-white/10 bg-bny-deep/50 px-2.5 py-2 text-sm normal-case tracking-normal text-bny-paper outline-none placeholder:text-bny-paper/30 focus:border-bny-teal" /></label><button type="button" onClick={() => { const current = readStoredCalendars(); saveCalendars({ ...current, team: current.team.filter((item) => item.id !== calendar.id) }); }} className="mt-3 text-bny-teal hover:text-white">Remove</button></div>)}</div>}</div></aside>
        <div><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-bny-teal">Team overview</p><h2 className="mt-1 text-xl font-semibold">All external client meetings</h2></div><span className="hidden items-center gap-1.5 text-xs text-bny-paper/60 sm:flex"><Clock3 className="h-4 w-4 text-bny-teal" /> Chronological</span></div><EventList events={teamEvents} showOwner /></div>
      </div>}</section>

      <footer className="mt-10 flex items-center justify-between border-t border-white/10 py-5 text-xs text-bny-paper/40"><span>Client Meeting Intelligence</span><span className="flex items-center gap-1">Built for calendar visibility <ChevronRight className="h-3 w-3" /></span></footer>
    </div>
  </main>;
}
