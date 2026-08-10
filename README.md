# BNY Calendar Client Filter

A browser-only Next.js dashboard for identifying upcoming meetings with non-BNY attendees from `.ics` or iCalendar-formatted `.txt` files.

## Run locally

```bash
npm install
npm run dev
```

## Filter rule

An event is included when it is upcoming and at least one `ATTENDEE` email address does not contain `@bny.com`, case-insensitively. No calendar data is uploaded to a server.
