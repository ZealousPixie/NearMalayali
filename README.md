# NearMalayali

A privacy-first iOS and Android app that helps Malayalis living outside Kerala find, meet and connect with each other: nearby discovery, proximity alerts, and a community feed, chat, groups and events.

* **App:** Expo SDK 57 (React Native 0.86, TypeScript), Expo Router, development builds (not Expo Go).
* **Backend:** Supabase: Postgres with PostGIS, Row Level Security on every table, SECURITY DEFINER functions for privileged logic, Storage, Edge Functions.

Start with [docs/SETUP.md](docs/SETUP.md). Design decisions and risks are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). How nearby discovery and alerts work, their limits and the device test checklist are in [docs/LOCATION.md](docs/LOCATION.md).

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
| B. Nearby discovery, map, proximity alerts, push | **Built; database and unit tests pass. Needs two real phones to test (checklist in docs/LOCATION.md).** |
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

### What Stage B includes

* Location permission explainer before any system prompt; foreground-only mode for nearby lists; background mode only when proximity alerts are on.
* Background location task (≥100 m moves, balanced accuracy) plus a 250 m geofence backstop; tracking stops on sign-out, pause or discovery off.
* Discover tab: people around you by radius (100 m – 50 km) with coarse distance labels, interest and "open to" filters, empty and error states; explore any town (with a community count); people search; notification bell with unread count.
* Map tab: approximate community areas (cells with at least 3 people), town search; browsing never sends your location.
* Server-side matching with mutual opt-in, the stricter of both alert distances, accuracy thresholds, mocked-location exclusion, cooldowns, a daily cap, and block checks.
* Notification centre (mark read / mark all read) and push via Expo, with real delivery status recorded per notification.

### Tested here (in a Linux container, 2026-10-14)

* `npm run test:db`: 114 pgTAP assertions over RLS, column privileges, blocking, visibility, onboarding rules, rate limiting, storage folders, location reporting, nearby/area/map privacy, proximity matching, cooldowns and the push queue, against Postgres 16 + PostGIS 3.
* `npm test`: 16 Jest tests (validation, error mapping, sign-in screen, location reporting).
* `deno test supabase/functions/` and `deno check`: Edge Functions type-check; lock-screen privacy tests pass.
* `expo prebuild`: Android manifest and iOS Info.plist contain the expected background-location, foreground-service and permission strings.
* `npm run typecheck` (including typed routes) and `npm run lint`: clean.
* `expo export` for iOS and Android: JavaScript bundles build.

Not tested yet: anything on real iOS/Android devices or simulators (including background location, geofencing, maps and push), real Supabase Auth email flows, and the Edge Functions against a live project.

### Known gaps

* Google, Apple and phone sign-in are not implemented yet (email + password only).
* Changing your email address is not in the app yet.
* Legal texts are drafts for a lawyer to review.
* Push delivery receipts (Expo's second step) are not checked yet; "sent" means Expo accepted the push.
* Connect/follow/message buttons and reporting arrive in Stages C and D and are labelled as such in the app.
