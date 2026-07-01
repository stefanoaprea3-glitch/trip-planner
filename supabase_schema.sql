-- Trip Planner Schema
-- Incolla tutto questo nel SQL Editor di Supabase e clicca "Run"

-- Abilita UUID
create extension if not exists "uuid-ossp";

-- Tabella viaggi
create table if not exists trips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  data jsonb not null default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Aggiornamento automatico updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trips_updated_at
  before update on trips
  for each row execute function update_updated_at();

-- Row Level Security: ogni utente vede solo i suoi viaggi
alter table trips enable row level security;

create policy "Users can read own trips"
  on trips for select using (auth.uid() = user_id);

create policy "Users can insert own trips"
  on trips for insert with check (auth.uid() = user_id);

create policy "Users can update own trips"
  on trips for update using (auth.uid() = user_id);

create policy "Users can delete own trips"
  on trips for delete using (auth.uid() = user_id);
