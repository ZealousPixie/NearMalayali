# NearMalayali: architecture, risks and implementation sequence

_Last updated 2026-10-14 (Stage A)._

## 1. Environment inspected

| What | Found | Consequence |
|---|---|---|
| Node / npm | Node 22.22, npm 10.9 | Fine for Expo SDK 57 (current stable, `expo@57.0.28`). |
| Postgres | 16.15 + PostGIS 3 installed here | Migrations and Row Level Security can be tested for real against PostGIS. |
| Docker | Not available | The full Supabase local stack (`supabase start`) cannot run here. Tests use a small shim that recreates Supabase's `auth.users`, `auth.uid()` and the `anon` / `authenticated` / `service_role` roles, so RLS is exercised exactly as Supabase evaluates it. |
| iOS / Android devices, simulators | None | Native builds, background location and push must be tested by you on real phones. I will never report those as tested. |
| GitHub | No account linked to this project | Code lives in this container until a repo is attached. Unpushed work is lost when the container is reclaimed. |

## 2. Architecture in one picture

```
 ┌──────────────── Mobile app (one TypeScript codebase) ────────────────┐
 │ Expo SDK 57 development build (NOT Expo Go), Expo Router             │
 │  Tabs: Discover · Map · Community · Messages · Profile               │
 │  expo-location + expo-task-manager  → background location task       │
 │  react-native-maps (Apple Maps on iOS, Google Maps SDK on Android)   │
 │  expo-notifications (APNs on iOS, FCM on Android via Expo Push)      │
 │  supabase-js (anon key only; session in expo-secure-store)           │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ HTTPS (TLS)  · only RPCs + RLS-guarded tables
 ┌───────────────▼──────────────── Supabase ───────────────────────────┐
 │ Auth: email+password, verification, reset, Apple/Google (optional)  │
 │ Postgres 15+ with PostGIS                                           │
 │   • every table has RLS; private tables have NO client policies     │
 │   • privileged logic in SECURITY DEFINER functions (RPC)            │
 │     report_location(), nearby_users(), area_summary(), …            │
 │ Realtime: messages, typing, notifications                           │
 │ Storage: avatars, post media, chat media (private buckets + RLS)    │
 │ Edge Functions (Deno): send-push (reads notification outbox),       │
 │   delete-account (needs service role, never shipped to the app)     │
 │ pg_cron: location expiry, encounter/retention cleanup               │
 └─────────────────────────────────────────────────────────────────────┘
```

Why this shape: one managed backend (no microservices), one codebase for both stores, and every privacy rule enforced in Postgres where the app cannot bypass it.

## 3. The two hard parts

### 3.1 Location privacy (enforced in the database)

* `user_locations` holds **one current row per user** (no history), with exact point, accuracy and timestamp. It has RLS enabled and **no SELECT policy at all**: no ordinary user, including the owner via the API, can read coordinates. Only SECURITY DEFINER functions touch it.
* Rows expire: anything older than the stale window (default 30 min) is ignored by matching and deleted by a cron job after 24 h. Turning discovery off deletes the row immediately.
* `nearby_users()` returns profile cards with a **bucketed distance** ("under 500 m", "1–5 km"), never metres, and only for users who are discoverable, not paused, not blocked in either direction, and fresh.
* Map markers come from `map_cells()`: users are snapped to a coarse grid (about 1 km at small radii, coarser at larger ones) and a cell is only returned when it holds **at least 3 people**, so a single person can't be pinned down. Users who turn map visibility off are excluded entirely.
* **Searching another town** passes a centre point to `area_summary()` / `nearby_users(center => …)`. The caller's own location is not read or written by that call, so browsing Manjimup from Perth never places you in Manjimup.
* **Anti-probing:** per-user rate limits on discovery queries and location reports, distance buckets (blocks trilateration), minimum radius for remote browsing, and an audit of query volume for moderation.
* **Anti-spoofing (best effort):** reject reports with poor accuracy, reject impossible travel speed between reports, record Android's mock-location flag and exclude mocked reports from encounters.

### 3.2 Proximity alerts (server-side matching)

1. With "Always" permission (iOS) / background location + foreground service (Android), a background task sends `report_location()` only after the device moves a meaningful distance (default 100 m) or every ~10 min at most, at balanced accuracy, to save battery.
2. `report_location()` updates the single current row, then looks for other users whose fresh location is within **the smaller of both users' alert thresholds**, both having alerts enabled, not paused, not blocked, accuracy good enough (accuracy is added to the distance test to cut false positives).
3. A new `encounters` row is written per pair with a **cooldown** (default 6 h, user-configurable) enforced by a unique key, so retries can't create duplicates. A notification row is created for each side with a dedupe key.
4. A database trigger calls the `send-push` Edge Function, which sends via Expo Push and records success/failure on the notification row. A failure is stored as failed, never shown as sent.
5. The alert text never contains a location, distance or name: "A fellow Malayali is nearby. Would you like to discover your community?" An encounter grants no access; it only opens the Discover screen.

The other user's phone does not need to be broadcasting: each phone reports independently and the server compares the latest fresh positions.

### 3.3 What the OS will and won't allow (honest limits)

* **iOS:** background updates work while the app is backgrounded or suspended. If the user **force-quits** the app, standard updates stop; significant-location-change monitoring (~500 m moves) can relaunch it, which we use as a fallback. Detection is therefore "within minutes", not instant. Requires "Always" permission and an App Review justification.
* **Android:** needs `ACCESS_BACKGROUND_LOCATION` (granted separately in Settings on Android 11+) and a visible foreground-service notification. Some manufacturers (Xiaomi, Samsung, Huawei, OnePlus) kill background apps aggressively; the app will link to battery-optimisation settings. Google Play requires a background-location declaration form and a video.
* Two people passing for 30 seconds on a road may not be detected. People who share a town for an hour will be.

## 4. Data model (Stage A creates the foundation; later stages add the rest)

Stage A: `profiles`, `profile_visibility`, `discovery_settings`, `user_locations`, `notification_preferences`, `blocks`, `consents`, `user_roles`, `audit_log`, `rate_limits`.
Stage B: `encounters`, `notifications`, `push_tokens`.
Stage C (as built): `connection_requests`, `follows`, `conversations`, `conversation_members`, `messages` (attachments as a private-storage path on the message), `message_reactions`, `groups`, `group_members` (invitations and join requests are member rows with status `invited`/`requested`), `posts`, `post_media`, `post_reactions`, `post_comments`, `bookmarks`, `events`, `event_rsvps` (invitations are `invited` rows), `notices`. Clients read through RLS-filtered selects or SECURITY DEFINER functions; every write goes through a function that checks membership, blocks and rate limits. `events` has no client table grant at all, so the address can only be read through `event_details()`, which applies the host's address setting.
Stage D: `reports`, `moderation_actions`, plus moderation views.

Messages are encrypted in transit (TLS) and at rest (Supabase disk encryption). They are **not end-to-end encrypted**; the docs will say so.

## 5. Major risks

| Risk | Impact | Mitigation |
|---|---|---|
| Background location unreliable (force-quit iOS, Android OEM killers) | Missed alerts | Server-side matching, significant-change fallback, honest UI copy, battery-settings guidance. |
| App store rejection for background location | Launch delay | Feature is opt-in, clear purpose strings, a demo video, alerts usable without "Always" (foreground-only mode). |
| Stalking / trilateration via distance | User safety | Bucketed distances, grid cells with k ≥ 3, rate limits, no history, blocks enforced server-side, paused mode. |
| Location spoofing | Fake encounters | Speed checks, accuracy floor, mock-location flag, rate limits. Cannot be fully prevented. |
| Minors | Legal / safety | 18+ eligibility (date of birth check at onboarding, stored as a boolean, not displayed). |
| Cost growth | Budget | Supabase free tier for development, Pro (US$25/mo) at launch; Apple and Google Maps mobile SDKs are free; Expo Push is free. |
| No device testing here | Bugs found late | SQL tests for every privacy rule here; a device test checklist for you; EAS builds for real phones. |

## 6. Implementation sequence

* **Stage A – Foundation (now):** Expo app + routing, Supabase config, migrations with RLS, auth (sign up, verify, login, reset, sign out), onboarding with consent and age check, profile + photo, privacy settings. SQL tests for RLS.
* **Stage B – Core discovery:** location permission explainer, foreground + background reporting, `nearby_users`, `map_cells`, `area_summary`, Discover list, Map, encounters, notifications table, push via Edge Function. You test on two real phones.
* **Stage C – Social:** connections/follows, messaging (1:1, groups, media, realtime), feed, groups, events, noticeboard.
* **Stage D – Safety:** reporting, moderation queue + admin screens, audit logs, privacy and duplicate-suppression tests, lifecycle tests, battery tuning.
* **Stage E – Delivery:** README, env docs, EAS build profiles, store submission guide, cost estimate, limitations list.
