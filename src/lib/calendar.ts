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
  return filename.replace(/\.(ics|txt)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Team member';
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

function toClientMeeting(event: ICAL.Event, start: Date, end: Date, owner: string, suffix: string): CalendarEvent | null {
  if (isCancelled(event)) return null;
  const externalAttendees = externalAttendeesFor(event);
  if (externalAttendees.length === 0) return null;
  return { id: `${owner}-${event.uid || suffix}-${start.getTime()}`, title: event.summary || 'Untitled meeting', start, end, externalAttendees: [...new Set(externalAttendees)], owner };
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

  return masters.flatMap((event, index) => {
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

export function reviveCalendar(calendar: StoredCalendar): UploadedCalendar {
  const owner = calendar.owner || calendar.events[0]?.owner || friendlyOwner(calendar.name);
  return {
    ...calendar,
    owner,
    events: calendar.events.flatMap((event) => {
      const externalAttendees = event.externalAttendees.map(validEmail).filter(isExternalEmail);
      if (externalAttendees.length === 0 || /^cancel(?:ed|led):/i.test(event.title)) return [];
      return [{ ...event, externalAttendees: [...new Set(externalAttendees)], owner, start: new Date(event.start), end: new Date(event.end) }];
    }),
  };
}
