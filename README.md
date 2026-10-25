# Nexus Chat

A real-time chat starter built with React, TypeScript, Vite, and Supabase. It includes public rooms, guest usernames backed by Supabase anonymous authentication, private one-to-one conversations, message history, online presence, image sharing, user reports, and moderator restrictions.

> This is a starter that still requires your own Supabase project and deployment. Do not call it production-ready until you have tested the security policies and moderation workflow with separate accounts.

## What is included

- Responsive dark Liquid Glass-inspired interface
- Guest-only identity setup (no email/password UI)
- Public rooms: `welcome`, `general`, `gaming`, `creative`
- Persisted text messages and image messages
- Private direct conversations
- Realtime message updates and online presence
- Report-message action
- Moderator-only room creation and 24-hour user restriction action
- Supabase Row Level Security (RLS) policies and private image bucket

## Requirements

- Node.js 20 or newer recommended
- A Supabase project with Anonymous Sign-Ins enabled
- A terminal or cloud development environment

## 1. Create your Supabase project

1. Create a project at https://supabase.com.
2. Open **Authentication → Sign In / Providers** (the exact menu label may change) and enable **Anonymous Sign-Ins**.
3. Open **SQL Editor**, create a new query, paste all of `supabase/schema.sql`, and run it.
4. In **Project Settings → API** (menu wording can change), copy the Project URL and publishable key/legacy anon key.
5. Never put the `service_role` or another secret key in this frontend.

The SQL script creates the database tables, RLS policies, four starter rooms, a private `chat-images` storage bucket, and the RPC functions used by direct messages and moderation.

## 2. Run locally

```bash
npm install
cp .env.example .env
```

Open `.env` and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

Then run:

```bash
npm run dev
```

Open the local URL printed by Vite. On Windows, create `.env` by copying `.env.example` manually if `cp` is unavailable.

## 3. Promote your own guest profile to moderator

First open the site and create your guest username. In Supabase, open **Table Editor → profiles** and copy the UUID in the `id` column for your profile. Then run this in SQL Editor, replacing the example UUID:

```sql
insert into public.moderator_roles(user_id)
values ('00000000-0000-0000-0000-000000000000')
on conflict (user_id) do nothing;
```

Reload the site. The moderator role is stored separately from the public profile, and regular users cannot grant themselves moderator status through the frontend. Only grant this role to people you trust.

## 4. Deploy for a public URL

For a personal, non-commercial project, you can use a free static host such as Cloudflare Pages. Check current plan limits and terms before deploying.

Typical Git-based flow:

1. Put this project in a GitHub repository.
2. Create a Cloudflare Pages project and connect that repository.
3. Set the build command to `npm run build` and output directory to `dist`.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment-variable settings.
5. Deploy and test the published URL in a private/incognito window and on a phone.

The `VITE_` variables are included in frontend JavaScript at build time. They are not secrets. Security depends on RLS, Storage policies, and never exposing a service-role key.

## Security notes you must understand

- Guest usernames are display names, not recoverable accounts. Clearing browser data or losing the guest session can mean losing access to that identity and its DMs.
- Supabase anonymous sign-ins can be abused. Before inviting the public, configure CAPTCHA/Turnstile if supported by your auth setup, auth rate limits, storage limits, and abuse monitoring. Do not treat a public guest chat as spam-proof.
- The SQL grants moderators room creation and user restriction. The initial project creator is **not automatically a moderator**; manually add your profile UUID as described above.
- Public room messages and public-room images are visible to any authenticated guest. Direct-message records and DM image access are restricted to conversation participants.
- Test the private-DM policies with two separate browser profiles. Confirm that account A cannot query account B's DM or download its image URL.
- The starter reports harmful messages but does not yet include a complete moderator report-review dashboard, automated spam filtering, message rate limiting, appeals, or account recovery. Add these before operating a large public community.
- Moderation bans are keyed to the anonymous auth UUID, not a real-world identity. A determined spammer may return with a new guest session.
- Image uploads are limited to 5 MB and selected image MIME types. Client-side checks are for UX only; server policies and storage settings remain the actual access boundary.
- Supabase Free has quotas and can pause projects after inactivity. Check the current pricing and limits; free hosting is not unlimited.

## Troubleshooting

- **Anonymous sign-in fails:** enable Anonymous Sign-Ins in Supabase Auth and check project URL/key.
- **Database permission error:** make sure the entire `supabase/schema.sql` ran successfully. Check the failing table's RLS policy and browser console.
- **No live message updates:** make sure `public.messages` is enabled in the `supabase_realtime` publication (Database → Publications / Realtime settings).
- **Images fail:** check the private `chat-images` bucket and Storage policies. The app uses signed URLs for display.
- **Can't create a room or restrict a user:** grant your own profile UUID a moderator role using the SQL above, then reload.
- **A guest loses their username:** anonymous sessions are not account recovery. This is an inherent trade-off of guest-only access.

## Build check

```bash
npm run build
```
