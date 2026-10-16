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
  -- delade fält finns kvar för andra piloter, men utan koppling till kontot
  update public.fields set added_by = null where user_id = auth.uid();
  update public.field_comments set added_by = null where user_id = auth.uid();
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

-- Fält från Ultranav-piloter: små privata fält som läggs till via Rita & mät › Lägg till fält.
-- Alla inloggade kan se fälten. Bara den som lagt till ett fält, eller en administratör, kan ändra
-- eller ta bort det. Raderas kontot finns fältet kvar utan ägare (user_id blir null) och förvaltas
-- därefter av administratören; anropssignalen tas bort så att fältet inte längre pekar ut personen.
create table if not exists public.fields (
  id          uuid             primary key default gen_random_uuid(),
  user_id     uuid             default auth.uid() references auth.users (id) on delete set null,
  name        text             not null check (char_length(name) between 1 and 60),
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  rwy_len_m   integer          not null check (rwy_len_m between 50 and 5000),
  contact     text             check (contact is null or char_length(contact) <= 120),  -- null = okänd
  info        text             check (info is null or char_length(info) <= 1000),
  added_by    text             check (added_by is null or char_length(added_by) <= 12), -- anropssignal
  created_at  timestamptz      not null default now()
);

-- Om tabellen skapades med en tidigare version av filen: låt fälten finnas kvar när ett konto raderas
alter table public.fields alter column user_id drop not null;
alter table public.fields drop constraint if exists fields_user_id_fkey;
alter table public.fields add constraint fields_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

alter table public.fields enable row level security;

drop policy if exists "fields: inloggade läser" on public.fields;
drop policy if exists "fields: skapa egna"      on public.fields;
drop policy if exists "fields: ändra egna"      on public.fields;
drop policy if exists "fields: radera egna"     on public.fields;

create policy "fields: inloggade läser" on public.fields for select to authenticated using (true);
create policy "fields: skapa egna"      on public.fields for insert to authenticated with check (auth.uid() = user_id);
create policy "fields: ändra egna"      on public.fields for update to authenticated
  using (auth.uid() = user_id or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check (auth.uid() = user_id or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "fields: radera egna"     on public.fields for delete to authenticated
  using (auth.uid() = user_id or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Kommentarer på fält från Ultranav-piloter, t.ex. om banans skick. Alla inloggade kan läsa och skriva.
-- Den som skrev, fältets ägare och administratören kan ta bort en kommentar. Tas fältet bort försvinner
-- kommentarerna. Raderas kontot finns kommentaren kvar, men utan koppling till kontot.
create table if not exists public.field_comments (
  id          uuid        primary key default gen_random_uuid(),
  field_id    uuid        not null references public.fields (id) on delete cascade,
  user_id     uuid        default auth.uid() references auth.users (id) on delete set null,
  body        text        not null check (char_length(body) between 1 and 500),
  added_by    text        check (added_by is null or char_length(added_by) <= 12), -- anropssignal
  created_at  timestamptz not null default now()
);

create index if not exists field_comments_field on public.field_comments (field_id, created_at);

alter table public.field_comments enable row level security;

drop policy if exists "field_comments: inloggade läser" on public.field_comments;
drop policy if exists "field_comments: skapa egna"      on public.field_comments;
drop policy if exists "field_comments: radera"          on public.field_comments;

create policy "field_comments: inloggade läser" on public.field_comments for select to authenticated using (true);
create policy "field_comments: skapa egna"      on public.field_comments for insert to authenticated with check (auth.uid() = user_id);
create policy "field_comments: radera"          on public.field_comments for delete to authenticated using (
  auth.uid() = user_id
  or exists (select 1 from public.fields f where f.id = field_id and f.user_id = auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Administratör: ger kontot tillgång till Datakällor, CORS-proxy och Felsökning i appens inställningar.
-- Byt e-postadressen och kör en gång. Logga sedan ut och in i appen.
-- update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}' where email = 'din@epost.se';
