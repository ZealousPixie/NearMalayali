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
   ```
4. In the dashboard, **Database → Extensions**: enable `pg_cron` (used to purge stale locations every 15 min). Then re-run `supabase db push` or run this once in the SQL editor:
   ```sql
   select cron.schedule('purge-stale-locations', '*/15 * * * *', 'select public.purge_stale_locations()');
   ```

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
```

`npm run test:db` creates a throwaway database, applies a small shim that imitates Supabase's auth roles (`supabase/tests/shim`), applies every migration and runs the pgTAP files in `supabase/tests/database`. It needs `psql`, `pg_prove`, PostGIS and pgTAP. On Ubuntu: `apt install postgresql-16 postgresql-16-postgis-3 postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl`.

If you have Docker, `supabase start` runs the full local stack instead; the shim is then unnecessary.

## 6. Production builds and stores

Covered in detail in Stage E. In short: `eas build --profile production`, then `eas submit`. Before submitting, replace the draft legal texts in `src/lib/legal.ts` with lawyer-reviewed versions and host the privacy policy at a public URL (both stores require one).
