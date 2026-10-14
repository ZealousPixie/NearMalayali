# Setting up NearMalayali

This guide assumes no prior Supabase or Expo experience. It covers what exists after Stage A; later stages add sections for location, maps and push notifications.

## 1. Accounts you need

| Service | Why | Cost to start |
|---|---|---|
| [Supabase](https://supabase.com) | Database, sign-in, file storage, server functions | Free tier (pauses after 7 days idle). Pro is US$25/month per project; use it for launch. |
| [Expo / EAS](https://expo.dev) | Cloud builds for iOS and Android, store submission | Free tier: limited monthly builds, slower queue. |
| Apple Developer Program | Install on iPhones outside a simulator, TestFlight, App Store | US$99/year |
| Google Play Console | Android release | US$25 one-off |
| An email sending service (e.g. Resend, Postmark, AWS SES) | Supabase's built-in email is limited to a few emails per hour, which is fine for testing but not for real users | Free tiers available; roughly US$0–20/month at launch volume |

Later stages: a Google Maps API key for Android maps (the mobile Maps SDK is free to use, but needs a billing account on Google Cloud). Apple Maps on iOS needs no key. Expo Push notifications are free.

## 2. Create the Supabase project

1. Sign in at supabase.com → **New project**. Pick the region closest to most users (e.g. Sydney for Australia). Save the database password somewhere safe.
2. Install the Supabase CLI on your computer: `npm install -g supabase` (or `brew install supabase/tap/supabase`).
3. From this repository:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF      # the ref is in the project URL
   supabase db push                                   # applies supabase/migrations/*
   supabase functions deploy delete-account
   supabase functions deploy send-push --no-verify-jwt
   ```
4. In the dashboard, **Database → Extensions**: enable `pg_cron` (used to purge stale locations every 15 min). Then re-run `supabase db push` or run this once in the SQL editor:
   ```sql
   select cron.schedule('purge-stale-locations', '*/15 * * * *', 'select public.purge_stale_locations()');
   ```

### Push notifications (Stage B)

Proximity alerts and other notifications are stored in the database and then sent by the `send-push` function through Expo's free push service.

1. **Extensions:** enable `pg_net` and `pg_cron` (Database → Extensions).
2. **A shared secret** so only your database can trigger sending. Generate one (e.g. `openssl rand -hex 32`) and:
   * set it on the function: `supabase secrets set PUSH_DISPATCH_SECRET=<value>`
   * store it, and your project URL, in Vault (SQL editor):
     ```sql
     select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
     select vault.create_secret('<the same value>', 'push_dispatch_secret');
     select cron.schedule('push-dispatch', '* * * * *', 'select public.kick_push_dispatch()');
     ```
3. **Apple (iOS push):** run `npx eas-cli@latest credentials` → iOS → Push Notifications → let EAS create an APNs key. Needs the Apple Developer account.
4. **Google (Android push):** create a Firebase project, add an Android app with package `com.nearmalayali.app`, download `google-services.json`, and upload the FCM V1 service-account key in `eas credentials` → Android → Google Service Account → FCM V1. Add `"googleServicesFile": "./google-services.json"` under `android` in app.json (don't commit the file if your repo is public).
5. **EAS project ID:** `npx eas-cli@latest init` links the app to an EAS project; set `EAS_PROJECT_ID` (shown by that command) in EAS environment variables and in `.env` for local builds. Push registration needs it.
6. Optional: set `EXPO_ACCESS_TOKEN` on the function (`supabase secrets set`) if you enable "enhanced push security" in Expo.

If any of this is missing, notifications still appear in the in-app notification centre; nothing is shown as sent unless Expo accepted it.

### Chat, feed and events (Stage C)

* **Storage buckets** `chat-media` and `post-media` are created as **private** by the migrations; nothing to do. Photos are served through signed links that expire after an hour.
* **Realtime:** the migrations add `messages`, `message_reactions`, `conversation_members` and `notifications` to the `supabase_realtime` publication. Check **Database → Publications → supabase_realtime** lists them (if the publication didn't exist when you ran the migrations, toggle those tables on there). Realtime applies the same row-level security, so people only receive messages from their own chats.
* **Event reminders:** with `pg_cron` enabled, the migration schedules `send_event_reminders()` hourly. If pg_cron was enabled afterwards, run once:
  ```sql
  select cron.schedule('event-reminders', '5 * * * *', 'select public.send_event_reminders()');
  ```

### Maps (Stage B)

* **iOS** uses Apple Maps: nothing to configure.
* **Android** uses Google Maps. In Google Cloud Console create a project, enable *Maps SDK for Android*, create an API key **restricted to Android apps** with package `com.nearmalayali.app` and your signing certificate SHA-1 (`eas credentials` shows it). Set it as `GOOGLE_MAPS_ANDROID_API_KEY` in EAS environment variables (or `.env` for local builds). Mobile map loads are free, but Google requires a billing account.
* **Town search** uses the phone's geocoder, falling back to OpenStreetMap Nominatim on Android when location permission isn't granted. Nominatim is free for low volume (max 1 request/second); swap in a paid geocoder (e.g. Mapbox, Google Geocoding) in `src/lib/geo.ts` if usage grows.

### Auth settings (Dashboard → Authentication)

`supabase/config.toml` holds these for local development, but the hosted project must be set in the dashboard:

* **Sign In / Providers → Email:** enable *Confirm email*; enable *Secure password change*; minimum password length 8 with *letters and digits*.
* **Emails → Templates:** NearMalayali verifies by **6-digit code**, not by link, so no deep-link setup is needed. Replace the bodies of:
  * *Confirm signup* with the content of `supabase/templates/confirmation.html`
  * *Reset password* with the content of `supabase/templates/recovery.html`
  Both use `{{ .Token }}`.
* **Emails → SMTP:** add your email provider's SMTP details before inviting real users.
* **Rate limits:** the defaults are fine to start.

### Create your admin account

After you sign up in the app, make yourself an administrator (the moderation dashboard arrives in Stage D) in the SQL editor:
```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com';
```

## 3. Configure the app

```bash
cp .env.example .env
```
Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from **Project Settings → API**. Use the *anon* / *publishable* key. **Never** put the `service_role` / secret key in the app or in `.env`: it bypasses all security rules. If the values are missing, the app shows a "Backend not configured" screen instead of crashing.

## 4. Run on a phone or simulator

NearMalayali uses native modules (secure storage now; background location and maps later), so it runs as a **development build**, not in Expo Go.

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android   # installs as an APK
npx eas-cli@latest build --profile development --platform ios        # needs Apple Developer account
npm start                                                            # then open the dev build on the phone
```
With Xcode (Mac) or Android Studio installed you can instead build locally: `npx expo run:ios` / `npx expo run:android`.

For the iOS Simulator only: `eas build --profile development-simulator --platform ios`.

## 5. Tests

```bash
npm test            # unit + screen tests (Jest)
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run test:db     # database security tests (needs Postgres + PostGIS + pgTAP, see below)
deno test supabase/functions/   # Edge Function unit tests (needs Deno)
```

`npm run test:db` creates a throwaway database, applies a small shim that imitates Supabase's auth roles (`supabase/tests/shim`), applies every migration and runs the pgTAP files in `supabase/tests/database`. It needs `psql`, `pg_prove`, PostGIS and pgTAP. On Ubuntu: `apt install postgresql-16 postgresql-16-postgis-3 postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl`.

If you have Docker, `supabase start` runs the full local stack instead; the shim is then unnecessary.

## 6. Production builds and stores

Location-specific store requirements are in [LOCATION.md](LOCATION.md#store-review-notes). Full submission steps are covered in Stage E. In short: `eas build --profile production`, then `eas submit`. Before submitting, replace the draft legal texts in `src/lib/legal.ts` with lawyer-reviewed versions and host the privacy policy at a public URL (both stores require one).
