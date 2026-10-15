-- Ultranav — databasschema för Supabase
-- Kör hela filen i Supabase: SQL Editor › New query › klistra in › Run.
-- Allt användarinnehåll ligger i en tabell. Row Level Security gör att varje användare
-- bara kan läsa och ändra sina egna rader. Delade objekt hämtas enbart via delningskod.

create table if not exists public.items (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id          text        not null,                 -- skapas i appen (samma id lokalt och i molnet)
  kind        text        not null check (kind in ('route', 'drawing', 'layer', 'flight', 'settings')),
  name        text        not null default '',
  data        jsonb       not null default '{}'::jsonb,
  deleted     boolean     not null default false,   -- borttaget (synkas till andra enheter)
  share_code  text        unique,                   -- satt när objektet delas
  is_shared   boolean     not null default false,
  updated_at  timestamptz not null default now(),   -- sätts av appen: senaste ändring vinner
  created_at  timestamptz not null default now(),
  primary key (user_id, id),
  constraint items_data_size check (pg_column_size(data) < 10000000)  -- max ≈ 10 MB per objekt
);

create index if not exists items_user_updated on public.items (user_id, updated_at);

alter table public.items enable row level security;

drop policy if exists "items: läs egna"    on public.items;
drop policy if exists "items: skapa egna"  on public.items;
drop policy if exists "items: ändra egna"  on public.items;
drop policy if exists "items: radera egna" on public.items;

create policy "items: läs egna"    on public.items for select to authenticated using (auth.uid() = user_id);
create policy "items: skapa egna"  on public.items for insert to authenticated with check (auth.uid() = user_id);
create policy "items: ändra egna"  on public.items for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items: radera egna" on public.items for delete to authenticated using (auth.uid() = user_id);

-- Hämta ett delat objekt med dess kod. Fungerar även utan inloggning, men går inte att
-- använda för att lista andras innehåll (koden måste vara känd).
create or replace function public.get_shared(code text)
returns table (kind text, name text, data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select i.kind, i.name, i.data
  from public.items i
  where i.share_code = code and i.is_shared and not i.deleted
  limit 1;
$$;

revoke all on function public.get_shared(text) from public;
grant execute on function public.get_shared(text) to anon, authenticated;

-- Radera det egna kontot och allt sparat innehåll (GDPR). Anropas från appen: Konto › Radera konto.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'inte inloggad'; end if;
  delete from public.items where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Trafik: privat realtidskanal "traffic" där bara inloggade får skicka och ta emot positioner.
-- (Positionerna sparas inte — de skickas direkt mellan användarna.)
drop policy if exists "traffic: inloggade läser"  on realtime.messages;
drop policy if exists "traffic: inloggade skickar" on realtime.messages;
create policy "traffic: inloggade läser"  on realtime.messages for select to authenticated using (realtime.topic() = 'traffic');
create policy "traffic: inloggade skickar" on realtime.messages for insert to authenticated with check (realtime.topic() = 'traffic');

-- Administratör: ger kontot tillgång till Datakällor, CORS-proxy och Felsökning i appens inställningar.
-- Byt e-postadressen och kör en gång. Logga sedan ut och in i appen.
-- update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}' where email = 'din@epost.se';
