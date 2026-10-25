-- Nexus Chat schema for Supabase. Run once in the Supabase SQL Editor.
-- This script intentionally keeps moderator privileges separate from editable profiles.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,18}$')
);
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9-]{2,24}$'),
  description text not null default 'A place to chat' check (char_length(description) <= 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_participants_user_idx on public.conversation_participants(user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint messages_one_destination check (
    (room_id is not null and conversation_id is null) or
    (room_id is null and conversation_id is not null)
  ),
  constraint messages_body_or_image check (
    (body is not null and char_length(btrim(body)) between 1 and 2000) or
    (body is null and image_path is not null)
  )
);
create index if not exists messages_room_created_idx on public.messages(room_id, created_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

create table if not exists public.moderator_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table if not exists public.user_bans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null default 'Community rules',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  reported_sender_id uuid references public.profiles(id) on delete set null,
  reported_body text,
  reported_image_path text,
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','reviewed','dismissed'))
);
create index if not exists reports_status_created_idx on public.reports(status, created_at desc);

-- Snapshot the reported message at report time so moderators can review a report without being granted broad access to private DMs.
create or replace function public.snapshot_reported_message()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  select m.sender_id, m.body, m.image_path
    into new.reported_sender_id, new.reported_body, new.reported_image_path
  from public.messages m where m.id = new.message_id;
  if new.reported_sender_id is null then raise exception 'Message not found.'; end if;
  return new;
end;
$$;
drop trigger if exists reports_snapshot_message on public.reports;
create trigger reports_snapshot_message before insert on public.reports for each row execute function public.snapshot_reported_message();

create or replace function public.is_moderator(check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.moderator_roles where user_id = check_user); $$;

create or replace function public.is_banned(check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_bans where user_id = check_user and (expires_at is null or expires_at > now())); $$;

create or replace function public.is_conversation_member(check_conversation uuid, check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.conversation_participants where conversation_id = check_conversation and user_id = check_user); $$;

create or replace function public.create_direct_conversation(target_user_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare current_user_id uuid := auth.uid(); existing_id uuid; new_id uuid;
begin
  if current_user_id is null then raise exception 'Sign in first.'; end if;
  if public.is_banned(current_user_id) then raise exception 'Your guest session is restricted.'; end if;
  if target_user_id is null or target_user_id = current_user_id then raise exception 'Choose another user.'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then raise exception 'User not found.'; end if;
  select c.id into existing_id
  from public.conversations c
  where (select count(*) from public.conversation_participants cp where cp.conversation_id = c.id) = 2
    and exists (select 1 from public.conversation_participants cp where cp.conversation_id = c.id and cp.user_id = current_user_id)
    and exists (select 1 from public.conversation_participants cp where cp.conversation_id = c.id and cp.user_id = target_user_id)
  limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.conversations default values returning id into new_id;
  insert into public.conversation_participants(conversation_id, user_id) values (new_id, current_user_id), (new_id, target_user_id);
  return new_id;
end;
$$;

create or replace function public.list_direct_conversations()
returns table(conversation_id uuid, other_user_id uuid, other_username text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select c.id, other_profile.id, other_profile.username, c.updated_at
  from public.conversations c
  join public.conversation_participants mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
  join public.conversation_participants theirs on theirs.conversation_id = c.id and theirs.user_id <> auth.uid()
  join public.profiles other_profile on other_profile.id = theirs.user_id
  order by c.updated_at desc;
$$;

create or replace function public.moderate_user(target_user_id uuid, ban_reason text, duration_minutes integer default 1440)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_moderator(auth.uid()) then raise exception 'Moderator access required.'; end if;
  if target_user_id = auth.uid() then raise exception 'You cannot restrict your own account.'; end if;
  if duration_minutes < 1 or duration_minutes > 525600 then raise exception 'Duration must be between 1 minute and 365 days.'; end if;
  insert into public.user_bans(user_id, moderator_id, reason, expires_at)
  values (target_user_id, auth.uid(), left(coalesce(nullif(btrim(ban_reason), ''), 'Community rules'), 300), now() + make_interval(mins => duration_minutes))
  on conflict (user_id) do update set moderator_id = excluded.moderator_id, reason = excluded.reason, created_at = now(), expires_at = excluded.expires_at;
end;
$$;

create or replace function public.touch_conversation_on_message()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.conversation_id is not null then update public.conversations set updated_at = now() where id = new.conversation_id; end if;
  return new;
end;
$$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages for each row execute function public.touch_conversation_on_message();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.moderator_roles enable row level security;
alter table public.user_bans enable row level security;
alter table public.reports enable row level security;

-- Profiles are discoverable by username for guest-to-guest DMs. Users cannot grant themselves roles.
drop policy if exists "profiles readable by authenticated guests" on public.profiles;
create policy "profiles readable by authenticated guests" on public.profiles for select to authenticated using (true);
drop policy if exists "guests create own profile" on public.profiles;
create policy "guests create own profile" on public.profiles for insert to authenticated with check (id = auth.uid() and not public.is_banned(auth.uid()));
drop policy if exists "guests update own username" on public.profiles;
create policy "guests update own username" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Public rooms are readable to signed-in guests; only moderators may create/delete them.
drop policy if exists "rooms readable by authenticated guests" on public.rooms;
create policy "rooms readable by authenticated guests" on public.rooms for select to authenticated using (true);
drop policy if exists "moderators create rooms" on public.rooms;
create policy "moderators create rooms" on public.rooms for insert to authenticated with check (public.is_moderator(auth.uid()) and created_by = auth.uid() and not public.is_banned(auth.uid()));
drop policy if exists "moderators delete rooms" on public.rooms;
create policy "moderators delete rooms" on public.rooms for delete to authenticated using (public.is_moderator(auth.uid()));

-- Conversations and participants are private to participants; membership is created through the RPC only.
drop policy if exists "participants can read conversations" on public.conversations;
create policy "participants can read conversations" on public.conversations for select to authenticated using (public.is_conversation_member(id, auth.uid()));
drop policy if exists "participants can read participant rows" on public.conversation_participants;
create policy "participants can read participant rows" on public.conversation_participants for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));

-- Public-room messages are visible to authenticated guests; DM messages only to conversation members.
drop policy if exists "read room or own dm messages" on public.messages;
create policy "read room or own dm messages" on public.messages for select to authenticated using (
  (room_id is not null) or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid()))
);
drop policy if exists "send room or dm messages as self" on public.messages;
create policy "send room or dm messages as self" on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and not public.is_banned(auth.uid()) and
  ((room_id is not null and conversation_id is null) or
   (room_id is null and conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid())))
);
drop policy if exists "delete own messages or moderator messages" on public.messages;
create policy "delete own messages or moderator messages" on public.messages for delete to authenticated using (sender_id = auth.uid() or public.is_moderator(auth.uid()));

-- A guest can see only their own ban record; moderators manage bans through the protected RPC.
drop policy if exists "users can view own ban" on public.user_bans;
create policy "users can view own ban" on public.user_bans for select to authenticated using (user_id = auth.uid() or public.is_moderator(auth.uid()));
drop policy if exists "moderators view own role" on public.moderator_roles;
create policy "moderators view own role" on public.moderator_roles for select to authenticated using (user_id = auth.uid());

-- Reports are private to the reporter and moderators. Only authenticated users can report as themselves.
drop policy if exists "users create reports as self" on public.reports;
create policy "users create reports as self" on public.reports for insert to authenticated with check (reporter_id = auth.uid() and not public.is_banned(auth.uid()));
drop policy if exists "reporters and moderators read reports" on public.reports;
create policy "reporters and moderators read reports" on public.reports for select to authenticated using (reporter_id = auth.uid() or public.is_moderator(auth.uid()));
drop policy if exists "moderators update reports" on public.reports;
create policy "moderators update reports" on public.reports for update to authenticated using (public.is_moderator(auth.uid())) with check (public.is_moderator(auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.rooms to authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_participants to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select on public.moderator_roles to authenticated;
grant select on public.user_bans to authenticated;
grant select, insert, update on public.reports to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.list_direct_conversations() to authenticated;
grant execute on function public.moderate_user(uuid, text, integer) to authenticated;
grant execute on function public.is_moderator(uuid) to authenticated;
grant execute on function public.is_banned(uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

-- Default public rooms. Safe to re-run.
insert into public.rooms(name, description) values
  ('welcome', 'Say hello and meet the community'),
  ('general', 'Everyday conversations'),
  ('gaming', 'Games, updates and clips'),
  ('creative', 'Share ideas and projects')
on conflict (name) do nothing;

-- Private image bucket. Image paths must be room/<room-uuid>/<file> or dm/<conversation-uuid>/<file>.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif'];

drop policy if exists "read chat images allowed by folder" on storage.objects;
create policy "read chat images allowed by folder" on storage.objects for select to authenticated using (
  bucket_id = 'chat-images' and (
    ((storage.foldername(name))[1] = 'room' and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$') or
    ((storage.foldername(name))[1] = 'dm' and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid()))
  )
);
drop policy if exists "upload own chat images to allowed destination" on storage.objects;
create policy "upload own chat images to allowed destination" on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-images' and owner_id = auth.uid()::text and not public.is_banned(auth.uid()) and
  (
    ((storage.foldername(name))[1] = 'room' and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and exists (select 1 from public.rooms r where r.id = ((storage.foldername(name))[2])::uuid)) or
    ((storage.foldername(name))[1] = 'dm' and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and public.is_conversation_member(((storage.foldername(name))[2])::uuid, auth.uid()))
  )
);
drop policy if exists "delete own chat images or moderator images" on storage.objects;
create policy "delete own chat images or moderator images" on storage.objects for delete to authenticated using (bucket_id = 'chat-images' and (owner_id = auth.uid()::text or public.is_moderator(auth.uid())));

-- Realtime publication: messages are broadcast from Postgres changes. Ignore if already added.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then raise notice 'supabase_realtime publication not found; enable Realtime for messages in the dashboard.';
end $$;
