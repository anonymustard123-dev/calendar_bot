import ICAL from 'ical.js';

export type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  externalAttendees: string[];
  owner: string;
};

export type UploadedCalendar = {
  id: string;
  name: string;
  owner: string;
  events: CalendarEvent[];
};

export type StoredCalendar = Omit<UploadedCalendar, 'events'> & {
  events: Array<Omit<CalendarEvent, 'start' | 'end'> & { start: string; end: string }>;
};

const MAX_LOOKAHEAD_DAYS = 90;

function validEmail(value: string) {
  const email = value.replace(/^mailto:/i, '').trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

function isExternalEmail(email: string | null): email is string {
  return email !== null && !email.toLowerCase().endsWith('@bny.com');
}

export function friendlyOwner(filename: string) {
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    // Use the original filename if it contains an invalid percent-escape.
  }
  const owner = decoded
    .replace(/\.(ics|txt)$/i, '')
    .replace(/%20/gi, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(calendar|dummy|client|meeting|meetings|export|v\d+|\d{10,})\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return owner || 'Team member';
}

function externalAttendeesFor(event: ICAL.Event) {
  return event.component
    .getAllProperties('attendee')
    .map((property) => {
      const calendarAddress = validEmail(String(property.getFirstValue() ?? ''));
      if (calendarAddress) return calendarAddress;
      const emailParameter = property.getParameter('email');
      return validEmail(Array.isArray(emailParameter) ? String(emailParameter[0] ?? '') : String(emailParameter ?? ''));
    })
    .filter(isExternalEmail);
}

function isCancelled(event: ICAL.Event) {
  const status = String(event.component.getFirstPropertyValue('status') ?? '').toLowerCase();
  return status === 'cancelled' || /^cancel(?:ed|led):/i.test(event.summary ?? '');
}

function meetingKey(meeting: CalendarEvent) {
  return [
    meeting.owner.trim().toLowerCase(),
    meeting.start.getTime(),
    meeting.end.getTime(),
    meeting.title.replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join('|');
}

export function dedupeCalendarEvents(meetings: CalendarEvent[]) {
  const unique = new Map<string, CalendarEvent>();
  meetings.forEach((meeting) => {
    const key = meetingKey(meeting);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, meeting);
      return;
    }
    // Outlook can export one logical meeting through multiple VEVENT records
    // with different attendee groups. Keep one occurrence and combine those groups.
    unique.set(key, {
      ...existing,
      externalAttendees: [...new Set([...existing.externalAttendees, ...meeting.externalAttendees])],
    });
  });
  return [...unique.values()];
}

function toClientMeeting(event: ICAL.Event, start: Date, end: Date, owner: string, suffix: string, master?: ICAL.Event): CalendarEvent | null {
  if (isCancelled(event)) return null;
  // Outlook sometimes emits a sparse recurrence exception: it has the changed
  // date/time but none of the series' SUMMARY or ATTENDEE properties. In that
  // case inherit those fields from the master series. An exception that does
  // contain ATTENDEE values remains authoritative.
  const hasInstanceAttendees = event.component.getAllProperties('attendee').length > 0;
  const externalAttendees = hasInstanceAttendees || !master ? externalAttendeesFor(event) : externalAttendeesFor(master);
  if (externalAttendees.length === 0) return null;
  return {
    id: `${owner}-${event.uid || master?.uid || suffix}-${start.getTime()}`,
    title: event.summary || master?.summary || 'Untitled meeting',
    start,
    end,
    externalAttendees: [...new Set(externalAttendees)],
    owner,
  };
}

export function parseCalendar(text: string, owner: string, referenceDate = new Date()): CalendarEvent[] {
  const component = new ICAL.Component(ICAL.parse(text));
  const lookahead = new Date(referenceDate);
  lookahead.setDate(lookahead.getDate() + MAX_LOOKAHEAD_DAYS);
  const records = component.getAllSubcomponents('vevent').map((vevent) => new ICAL.Event(vevent));
  const masters = records.filter((event) => !event.isRecurrenceException());

  records.filter((event) => event.isRecurrenceException()).forEach((exception) => {
    masters.find((event) => event.uid === exception.uid)?.relateException(exception);
  });

  const meetings = masters.flatMap((event, index) => {
    try {
      if (!event.isRecurring()) {
        const start = event.startDate?.toJSDate();
        const end = event.endDate?.toJSDate() ?? start;
        const clientMeeting = start && end && end >= referenceDate ? toClientMeeting(event, start, end, owner, String(index)) : null;
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
        if (end >= referenceDate) {
          const clientMeeting = toClientMeeting(details.item, start, end, owner, `${index}-${start.getTime()}`, event);
          if (clientMeeting) occurrences.push(clientMeeting);
        }
        occurrence = iterator.next();
      }
      return occurrences;
    } catch {
      return [];
    }
  });
  // Outlook exports can include a logical occurrence through multiple master
  // series and exception records. De-duplicate by its visible identity, while
  // preserving any external attendees contributed by each record.
  return dedupeCalendarEvents(meetings);
}

export function reviveCalendar(calendar: StoredCalendar): UploadedCalendar {
  const owner = friendlyOwner(calendar.owner || calendar.events[0]?.owner || calendar.name);
  return {
    ...calendar,
    owner,
    events: dedupeCalendarEvents(calendar.events.flatMap((event) => {
      const externalAttendees = event.externalAttendees.map(validEmail).filter(isExternalEmail);
      if (externalAttendees.length === 0 || /^cancel(?:ed|led):/i.test(event.title)) return [];
      return [{ ...event, externalAttendees: [...new Set(externalAttendees)], owner, start: new Date(event.start), end: new Date(event.end) }];
    })),
  };
}
