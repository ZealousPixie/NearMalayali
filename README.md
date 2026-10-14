# NearMalayali

A privacy-first iOS and Android app that helps Malayalis living outside Kerala find, meet and connect with each other: nearby discovery, proximity alerts, and a community feed, chat, groups and events.

* **App:** Expo SDK 57 (React Native 0.86, TypeScript), Expo Router, development builds (not Expo Go).
* **Backend:** Supabase: Postgres with PostGIS, Row Level Security on every table, SECURITY DEFINER functions for privileged logic, Storage, Edge Functions.

Start with [docs/SETUP.md](docs/SETUP.md). Design decisions and risks are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```
src/app/            screens (Expo Router; each file is a route)
  (auth)/           welcome, sign in/up, email code, password reset
  (onboarding)/     3-step onboarding: basics + age, profile, privacy + consent
  (app)/(tabs)/     Discover · Map · Community · Messages · Profile
  (app)/settings/   privacy, discovery, notifications, blocked, account
src/components/     shared UI
src/lib/            Supabase client, API wrappers, validation, errors
supabase/
  migrations/       schema, RLS policies, functions (apply with `supabase db push`)
  functions/        Edge Functions (Deno)
  tests/            pgTAP security tests + shim for running without Docker
docs/               architecture, setup
```

## Status

| Stage | State |
|---|---|
| A. Foundation: auth, onboarding, profiles, privacy settings, database security | **Built; database and unit tests pass. Not yet run on a device.** |
| B. Nearby discovery, map, proximity alerts, push | Not started |
| C. Connections, messaging, feed, groups, events, noticeboard | Not started |
| D. Reporting, moderation, safety and lifecycle testing | Not started |
| E. Store submission, costs, limitations | Not started |

Screens for unbuilt features say "Not yet implemented" with the stage that delivers them; nothing pretends to work.

### What Stage A includes

* Email + password sign-up with 6-digit email verification, sign-in, password reset by code, sign-out, change password.
* Onboarding with unique username (live availability check), display name, 18+ date-of-birth check (enforced on the server; date of birth is never shown), and recorded consent to versioned Terms, Privacy Policy and Community Guidelines.
* Profile with photo and cover upload (resized, metadata stripped, stored in the member's own folder), bio, region, languages, interests, occupation, introduction and "open to" preferences; edit any time.
* Per-field visibility (everyone / connections / only me) enforced by the database through `get_profile()`.
* Discovery settings: discoverable (off by default), map visibility, proximity alerts, radii, alert cooldown and timed pause. Turning discovery off or pausing deletes the stored location immediately.
* Notification preferences, people search (respects "appear in search" and blocks), blocking and unblocking, deactivation and reactivation, permanent deletion through an Edge Function.

### Tested here (in a Linux container, 2026-10-14)

* `npm run test:db`: 59 pgTAP assertions over RLS, column privileges, blocking, visibility, onboarding rules, rate limiting and storage folders, against Postgres 16 + PostGIS 3.
* `npm test`: 12 Jest tests (validation, error mapping, sign-in screen).
* `npm run typecheck` (including typed routes) and `npm run lint`: clean.
* `expo export` for iOS and Android: JavaScript bundles build.

Not tested yet: running on iOS/Android devices or simulators, real Supabase Auth email flows, the delete-account Edge Function against a live project.

### Known gaps in Stage A

* Google, Apple and phone sign-in are not implemented yet (email + password only).
* Changing your email address is not in the app yet.
* Legal texts are drafts for a lawyer to review.
