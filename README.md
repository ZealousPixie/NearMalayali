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
  (app)/chat/       conversations; chat-info/ for members, mute, leave
  (app)/group/ event/ post/   community detail screens
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
| C. Connections, messaging, feed, groups, events, noticeboard | **Built; database and unit tests pass. Not yet run on a device.** |
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

### What Stage C includes

* **Connections and follows:** connection requests with an optional note (accept, decline privately, cancel; asking someone who already asked you connects you), remove connection, follow/unfollow, remove a follower, connection and follower counts, connections list respecting its visibility setting, and a Connections screen with requests.
* **Messaging:** one-to-one and group chats with live updates (Supabase Realtime), photos (private storage, signed links, location data stripped), replies, six reactions, unsend for everyone, unread counts, mute, leave, search across your chats, and read receipts only when both people allow them. Non-connections arrive as message requests (at most 3 messages until accepted) according to the recipient's "who can message me" setting. Group chat admins can rename, add connections, remove members and make admins.
* **Feed and posts:** posts to everyone, to connections or to a group, up to 4 photos each (private bucket, signed links), edit, delete, reactions, comments with one level of replies, bookmarks ("Saved"), and sharing public posts. The feed shows your posts, your connections', public posts by people you follow and posts in your groups, with keyset pagination.
* **Groups:** public (join instantly), approval (admins approve) and private (hidden, invite-only) groups, each with a linked group chat that follows membership; roles owner/admin/moderator/member; invitations to connections; remove or ban; group posts and group events.
* **Events:** public, connections-only, group or invite-only events with capacity limits, RSVP (going/interested/can't go), the option to hide yourself from the attendee list, an address and online link shown only to people going (host's choice), invitations, edits and cancellation that notify attendees, and reminders about 24 hours before (hourly job).
* **Noticeboard:** accommodation, jobs, for sale, rides, services, lost & found, announcements and help wanted; notices expire after 1–60 days, need an account at least 3 days old, are limited to 3 a day, and are answered by in-app message. No payments are handled.
* Messages are encrypted in transit and at rest by Supabase but are **not end-to-end encrypted**; the app says so in every chat.

### Tested here (in a Linux container, 2026-10-14)

* `npm run test:db`: 225 pgTAP assertions over RLS, column privileges, blocking, visibility, onboarding rules, rate limiting, storage folders, location reporting, nearby/area/map privacy, proximity matching, cooldowns, the push queue, connection requests, follows, messaging and message requests, chat and post media access, groups and roles, post visibility and the feed, events (capacity, address and attendee privacy, reminders) and the noticeboard, against Postgres 16 + PostGIS 3.
* `npm test`: 26 Jest tests (validation, error mapping, sign-in screen, location reporting, notification routing, time formatting, post card actions).
* `deno test supabase/functions/` and `deno check`: Edge Functions type-check; lock-screen privacy tests pass.
* `expo prebuild`: Android manifest and iOS Info.plist contain the expected background-location, foreground-service and permission strings.
* `npm run typecheck` (including typed routes) and `npm run lint`: clean.
* `expo export` for iOS and Android: JavaScript bundles build.

Not tested yet: anything on real iOS/Android devices or simulators (including background location, geofencing, maps, push, photo picking and Realtime chat updates), real Supabase Auth email flows, and the Edge Functions against a live project.

### Known gaps

* Google, Apple and phone sign-in are not implemented yet (email + password only).
* Changing your email address is not in the app yet.
* Legal texts are drafts for a lawyer to review.
* Push delivery receipts (Expo's second step) are not checked yet; "sent" means Expo accepted the push.
* Reporting people, posts and messages arrives in Stage D and is labelled as such in the app.
* Voice notes and video messages aren't supported yet; chats and posts take text and photos.
* When someone unsends a photo, the message is removed for everyone immediately; the file itself is then deleted by the sender's app. If that second step fails (for example the phone goes offline), the file stays in private chat storage, where only members of that chat could still open it with a link they had already loaded. A server-side cleanup job is planned for Stage D.
* Typing indicators and online status settings exist but aren't shown yet.
