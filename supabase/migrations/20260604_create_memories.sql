create table if not exists public.memories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  category text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_updated_idx
  on public.memories (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
before update on public.memories
for each row execute function public.set_updated_at();

alter table public.memories enable row level security;

create policy "Users can read their own memories"
  on public.memories for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own memories"
  on public.memories for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own memories"
  on public.memories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own memories"
  on public.memories for delete to authenticated
  using ((select auth.uid()) = user_id);
