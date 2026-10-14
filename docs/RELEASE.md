# Releasing NearMalayali to the App Store and Google Play

This is the path from this repository to the stores. Steps marked **(you)** need your accounts or a decision; everything else is commands.

## 1. Before the first release

| Item | Why | Status |
|---|---|---|
| Lawyer-reviewed Terms, Privacy Policy and Community Guidelines in `src/lib/legal.ts`; bump `LEGAL_VERSIONS` in `src/lib/env.ts` | The current texts are drafts. Bumping the version re-asks existing members for consent. | **(you)** |
| A public web page for the Privacy Policy, and a support email | Both stores require a privacy policy URL; suspended members are told to contact support. | **(you)** |
| A web page or form where people can ask for account deletion without the app | Google Play requires one in addition to in-app deletion. A page saying "email support@… from your account's address" is enough to start. | **(you)** |
| Supabase **Pro** plan for the production project | The free plan pauses after a week of inactivity and has no backups. | **(you)** |
| Custom SMTP (Resend, Postmark, SES…) in Supabase Auth | Built-in email is capped at a few messages per hour. | **(you)** |
| Everything in [SETUP.md](SETUP.md): migrations, both Edge Functions, secrets, Vault entries, cron jobs, Realtime publication, your admin account | The app depends on all of them. | **(you)**, with the commands in SETUP |
| Device test passes: [LOCATION.md checklist](LOCATION.md#device-test-checklist-needs-two-phones-and-two-accounts), the [feature pass](#4-device-test-pass-before-each-release) below, and the battery protocol | Nothing has run on a real phone yet. | **(you)**, two phones |
| Decide on automated image moderation | See [MODERATION.md](MODERATION.md#not-built-needs-a-decision-or-a-service). Strongly recommended for an app with user photos and chat. | **(you)** |
| App icon and splash artwork | The current ones are placeholders in the brand colours. | **(you)** or a designer |

## 2. Build

Configure environment variables once in the EAS dashboard (Project › Environment variables) for the `production` and `preview` environments:

| Name | Value | Visibility |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Plain text (it ships in the app) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the anon / publishable key | Plain text (it ships in the app; RLS protects data) |
| `EAS_PROJECT_ID` | from `eas init` | Plain text |
| `GOOGLE_MAPS_ANDROID_API_KEY` | the Android-restricted key | Sensitive |

Never add the service-role key here.

```bash
npx eas-cli@latest build --profile preview --platform all      # internal testers (APK + ad-hoc iOS)
npx eas-cli@latest build --profile production --platform all   # store builds; build numbers auto-increment
```

The app version shown in the stores is `expo.version` in `app.json` (currently 1.0.0). Raise it for each public release.

## 3. Submit

### Apple App Store

1. **(you)** In App Store Connect, create the app with bundle ID `com.nearmalayali.app`.
2. `npx eas-cli@latest submit --platform ios --latest` uploads the build to TestFlight. Test it there first.
3. **App Privacy** questionnaire. Suggested answers (check against your final privacy policy). Nothing is used for tracking or advertising; no third-party analytics are included.
   * Contact info › Email address: app functionality, linked to the user.
   * Location › Precise and Coarse location: app functionality, linked to the user (stored only as a current position; never shown to others).
   * User content › Photos, Messages (other user content: posts, comments, notices): app functionality, linked to the user.
   * Identifiers › User ID: app functionality, linked to the user.
   * Sensitive info: none collected. Date of birth is collected only to check age 18+ (Other data › Other, app functionality).
4. **Age rating:** answer the questionnaire honestly; with user-generated content, chat and an 18+ requirement, expect **18+**.
5. **Review notes:** a demo account (create one, with a few posts and a group), the background-location justification from [LOCATION.md](LOCATION.md#store-review-notes), and a short screen recording of turning on proximity alerts. Mention that users can report and block from every profile, post, comment, message, group, event and notice, and that moderators review reports in the app.
6. Apple guideline 1.2 (user-generated content) asks for a way to filter objectionable material, report it, block users and contact the developer. Report, block and support contact are there; filtering is reactive moderation only, which reviewers sometimes question. Automated filtering (see MODERATION.md) addresses this.

### Google Play

1. **(you)** Create the app in Play Console, package `com.nearmalayali.app`. Let Google manage the app signing key.
2. **(you)** Create a Google Cloud service account with Play Console access and save its JSON key outside the repo; reference it in `eas.json` › `submit.production.android.serviceAccountKeyPath`.
3. `npx eas-cli@latest submit --platform android --latest` uploads to the internal testing track.
4. **Data safety** form: the same data as Apple's list above; data is encrypted in transit; users can request deletion (in the app and through your deletion web page).
5. **Permissions declarations:**
   * Background location: justification and a video showing the in-app explanation screen and the proximity-alerts toggle. Expect manual review.
   * Foreground service type `location`: the persistent "Proximity alerts are on" notification while alerts run.
6. **Content rating** questionnaire (social, user-generated content, chat) and **Target audience**: 18 and over.
7. Fill in the account-deletion URL (section 1).

## 4. Device test pass before each release

Run with two accounts on two phones (one iOS, one Android) on a `preview` build. Note device models and OS versions.

1. Sign up with a real email, verify with the code, onboard, add a photo. Sign out and in. Reset the password.
2. Phone A sends a connection request; B accepts from the notification. Both appear in each other's Connections.
3. A messages B: the message appears on B **without refreshing**; B gets a push when the app is closed; the lock screen shows "You have a new notification" unless previews are on.
4. Send a photo in chat; long-press to react, reply and unsend; the photo disappears for both.
5. A third account that isn't connected messages B: it arrives under Requests; accept and reply.
6. Post with photos to Everyone and to Connections; check visibility from a stranger account. Comment, react, save, share.
7. Create a public group, join from B, use the group chat; create an approval group and approve B; create a private group and invite B.
8. Create an event with capacity 1 and address "People going"; B sees no address until going; a third account sees "full".
9. Post a notice from an account at least 3 days old; message the author from it.
10. Report a post from B; as admin, open Moderation, remove it; the author is notified; B sees "Action taken" under My reports.
11. Suspend A for 1 day from the member page; A's app shows the suspension screen on returning to the foreground; A's posts disappear for B. Lift it.
12. Block A from B: chats, posts, groups lists and nearby lists hide each other.
13. Deactivate and reactivate A; delete a test account: its messages show "Message deleted" on the other phone.
14. Airplane mode on each screen: no crashes, an offline banner, retry works.
15. Accessibility: VoiceOver/TalkBack can reach and name every button; text scales at the largest font size.

## 5. After launch

* **Supabase dashboard:** database CPU and size, storage, Realtime connections, Edge Function errors.
* **Push health** (SQL): `select push_status, count(*) from notifications where created_at > now() - interval '1 day' group by 1;` A rising `failed` share usually means expired APNs/FCM credentials.
* **Reports queue:** check daily; urgent reasons are pinned to the top.
* **Crash reporting is not included.** Add Sentry (`@sentry/react-native`, free tier available) before a wide launch.
* **Updates:** JavaScript-only fixes can ship with EAS Update once configured; anything touching native config (permissions, plugins) needs a new store build.
