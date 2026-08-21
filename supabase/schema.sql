-- Run once in the Supabase SQL Editor.
-- This stores parsed team-meeting metadata, never raw .ics files.
create table if not exists public.calendar_team_workspaces (
  workspace_key text primary key,
  calendars jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.calendar_team_workspaces enable row level security;

create policy "calendar team workspace can be read" on public.calendar_team_workspaces for select to anon, authenticated using (workspace_key = 'team-calendars');
create policy "calendar team workspace can be created" on public.calendar_team_workspaces for insert to anon, authenticated with check (workspace_key = 'team-calendars');
create policy "calendar team workspace can be updated" on public.calendar_team_workspaces for update to anon, authenticated using (workspace_key = 'team-calendars') with check (workspace_key = 'team-calendars');

create or replace function public.touch_calendar_team_workspace_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists calendar_team_workspaces_touch on public.calendar_team_workspaces;
create trigger calendar_team_workspaces_touch before update on public.calendar_team_workspaces for each row execute function public.touch_calendar_team_workspace_updated_at();

-- Shared client labels, aliases, and next steps. Run this addition in the same SQL Editor.
create table if not exists public.calendar_client_profiles (
  workspace_key text primary key,
  profiles jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.calendar_client_profiles enable row level security;
create policy "calendar client profiles can be read" on public.calendar_client_profiles for select to anon, authenticated using (workspace_key = 'team-calendars');
create policy "calendar client profiles can be created" on public.calendar_client_profiles for insert to anon, authenticated with check (workspace_key = 'team-calendars');
create policy "calendar client profiles can be updated" on public.calendar_client_profiles for update to anon, authenticated using (workspace_key = 'team-calendars') with check (workspace_key = 'team-calendars');
