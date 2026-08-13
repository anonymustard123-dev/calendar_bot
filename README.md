# BNY Calendar Client Filter

A Next.js dashboard for identifying upcoming meetings with non-BNY attendees from `.ics` or iCalendar-formatted `.txt` files. Personal calendar data remains in the browser; parsed team-calendar meeting data can be shared through Supabase.

## Run locally

```bash
npm install
npm run dev
```

## Filter rule

An event is included when it is upcoming and at least one `ATTENDEE` email address does not contain `@bny.com`, case-insensitively.

## Deploy with shared Team Calendars

The app uses a password-gated, same-origin Vercel proxy because direct Supabase calls are blocked on the corporate network. The browser only calls this app's `/api/supabase/...` endpoint; Vercel holds the Supabase credentials.

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL Editor.
2. In **Vercel → Project Settings → Environment Variables**, add these values for Production (and Preview if wanted):

   ```text
   CALENDAR_ACCESS_PASSWORD=<strong shared dashboard password>
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_ANON_KEY=<Supabase publishable/anon key>
   ```

   Do not prefix these variables with `NEXT_PUBLIC_`, and never use a Supabase service-role key for this app.
3. Deploy. Users must enter `CALENDAR_ACCESS_PASSWORD` before reaching the dashboard or invoking the Supabase proxy. The access cookie lasts 12 hours.

Only parsed team meeting metadata (meeting title, dates/times, external attendee emails, and calendar owner) is stored in Supabase. Raw `.ics` files and personal-calendar data remain in the browser.
