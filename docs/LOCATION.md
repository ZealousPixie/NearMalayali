# Nearby discovery and proximity alerts: how they work and their limits

## What happens, step by step

1. **Everything starts off.** New members are not discoverable, not on the map and get no alerts. No location is collected.
2. **Turning on discovery** (Settings › Discovery & location) lets others find you. Opening Discover asks for "while using the app" location (with an explanation first), takes one balanced-accuracy fix and sends it to `report_location()`.
3. **Turning on proximity alerts** additionally asks for background location ("Always" on iOS, "Allow all the time" on Android) and push notification permission. The app then:
   * runs a background location task that only fires after you move ~100 m (Android: at most every 2 minutes), at "balanced" accuracy (Wi-Fi/cell assisted, not continuous GPS);
   * keeps a 250 m geofence around your last report. Leaving it wakes the app even when iOS has suspended normal updates, as a backstop.
4. **The server matches.** Each report replaces your single stored position (no history) and checks for members who:
   * also have discovery **and** alerts on, are not paused, deactivated or suspended;
   * reported within the last 15 minutes, without a mocked (fake-GPS) location;
   * are within the **smaller** of your two chosen alert distances;
   * have accurate enough fixes on both sides (accuracy no worse than half the alert distance, capped at 100 m, minimum 25 m), to reduce false alarms from GPS drift;
   * have not blocked you and you have not blocked them.
5. **Alerts are de-duplicated.** Each person gets at most one alert about the same member within their cooldown (default 12 h, adjustable 1 h–7 days), and at most 10 alerts a day. A per-pair database lock stops two phones reporting at the same instant from creating two alerts.
6. **The alert says nothing identifying:** "A fellow Malayali is nearby. Would you like to discover your community?" Tapping it opens Discover. An encounter never creates a connection or grants access to anything.
7. **Push delivery** goes through a queue: the notification is stored first (so it always appears in the in-app notification centre), then the `send-push` function sends it via Expo to APNs/FCM and records the actual result. Rows are marked `sent` only if Expo accepted them, then `delivered` once Apple/Google accepted them (checked through Expo receipts); otherwise `failed` (after 3 tries) or `skipped` (push turned off for that category, or no registered device). Stale pushes (over an hour old) are skipped rather than delivered late.

## Privacy protections (all enforced in the database)

| Threat | Protection |
|---|---|
| Reading someone's coordinates | `user_locations` has no client access at all. No function returns coordinates of other people. |
| Pinpointing by distance (trilateration) | Distances are coarse buckets ("Under 250 m", "1–2 km"…). Lists are not ordered by exact distance inside a bucket. Your own reported position can't jump around (speed check, 40 reports per 10 min). |
| Map pinpointing | Map shows grid-cell centres (≈1/5/10 km cells), only where ≥3 map-visible members are. Community counts under 3 are hidden. |
| Browsing reveals your location | "Explore a town" and the map send only the town or map centre. Your stored position is never read or changed by them (tested). |
| Invisible stalkers | You must be discoverable yourself to see who is around you. |
| Probing private fields | Interest / "open to" filters only match fields the person made visible to you. |
| Tracking over time | One current row per person. Deleted immediately when you turn discovery off, pause, deactivate or delete; otherwise purged after 24 h without updates. Alert history (who-alerted-whom, no location) is kept 30 days for cooldowns and abuse review. |
| Fake GPS | Android's mock-location flag is honoured: mocked positions are never listed or matched. Implausible jumps (faster than an airliner) are rejected. A determined spoofer on a rooted/jailbroken phone can still lie; this cannot be fully prevented on the client. |
| Blocked users | Excluded from nearby lists, counts, map, alerts and search in both directions. |

## Honest limitations

* **Not instant.** Detection typically happens within minutes, not seconds. Two people passing each other briefly on a road may not be detected; people in the same suburb, shop or event for a while usually will be.
* **iOS:** if you force-quit the app (swipe it away), iOS stops background location until you open the app again. Low Power Mode and poor signal reduce updates further.
* **Android:** a persistent "Proximity alerts are on" notification is required by Android while alerts run. Some manufacturers (Xiaomi, Huawei, OnePlus, Samsung, Oppo/Realme, Vivo) aggressively kill background apps; members may need to set NearMalayali to "unrestricted" battery use. See https://dontkillmyapp.com.
* **Both people need alerts on** and recent locations. If the other person's phone hasn't reported in 15 minutes, they won't match.
* **GPS accuracy indoors** is often 50–100 m, so the 100 m alert distance can miss people indoors; 500 m is the default for that reason.
* **"Delivered" means Apple or Google accepted the push**, confirmed through Expo's receipts about 15 minutes later. It can't prove the phone displayed it: Focus modes, notification settings and a phone that stays offline can still stop it.

## Battery

Balanced accuracy, ≥100 m distance filter, a 2-minute minimum interval on Android, no continuous GPS, and no background work at all unless proximity alerts are on. Expect a small single-digit percentage per day for an active member who moves around; stationary phones barely report. **This has not been measured yet**: it needs real phones. Use the protocol below before launch and record the numbers here.

### Battery measurement protocol

Use one iPhone and one mid-range Android phone (ideally one Samsung or Xiaomi, which restrict background apps the most), with a release-like build (`eas build --profile preview`).

1. Charge both to 100 %, close other apps, keep brightness and network settings the same for every run.
2. **Baseline day:** NearMalayali installed, signed in, discovery and alerts **off**. Normal routine (commute, work, home). Note the battery % at 8 am, 1 pm, 6 pm and 10 pm, and the per-app figure in Settings › Battery.
3. **Alerts day:** same routine with discovery **and** proximity alerts on (500 m, "Always"/"All the time" location).
4. **Stationary day:** alerts on, phone left at home on a desk.
5. Record: NearMalayali's share of battery use (iOS Settings › Battery › last 24 h; Android Settings › Battery › usage by app), the number of rows that phone wrote (`select count(*) from rate_limits where user_id = '…' and action = 'report_location'` within the day, before the purge), and any alerts received.

Acceptance target: on the alerts day, NearMalayali uses no more than about 3–5 % of a full charge, and close to 0 % on the stationary day. If higher, raise the distance filter (`distanceInterval` in `src/lib/location.ts`) or the Android interval before raising accuracy.

## Store review notes

* **Apple:** background location needs a clear justification. Suggested App Review note: "Proximity alerts are an opt-in feature that notifies the user when another opted-in member is nearby. Location is used in the background only while the user has proximity alerts enabled; it is never shown to other users." Record a short demo video.
* **Google Play:** complete the *Location permissions* declaration (background location), with the same justification and a video showing the in-app explanation screen and the toggle. Play reviews this manually; allow extra time.

## Device test checklist (needs two phones and two accounts)

Run with a development build (`eas build --profile development`). Record pass/fail and device models.

1. New account: Discover says you're not discoverable; Map loads without asking for location; no location rows exist (check in Supabase Table Editor → `user_locations`).
2. Turn on discovery → explanation screen → allow "while using". Discover shows "Around you" and your row appears in `user_locations` with a sensible accuracy.
3. Phone B does the same nearby: each sees the other with a bucketed distance, never metres.
4. Explore a town far away on phone A: A's `user_locations` row is unchanged.
5. Turn on proximity alerts on both (allow Always / all the time + notifications). Lock both phones, walk B ~1 km away, then back towards A. Both get "A fellow Malayali is nearby" within a few minutes of being within 500 m.
6. Repeat the approach within 12 h: no second alert.
7. Block B from A: no alerts, B disappears from A's lists and vice versa.
8. Pause discovery on A for 1 hour: A's location row disappears; B no longer sees A.
9. Turn off discovery on A: background notification (Android) disappears; row deleted.
10. Force-quit on iOS and walk away: note that no alerts arrive until the app is opened (expected limitation).
11. Airplane mode on A while moving, then reconnect: no errors shown; the next movement reports normally.
12. Turn push off for "Malayalis nearby" in settings: alert still appears in the notification centre but no push (`push_status = skipped`).
13. Android with battery optimisation on vs. "unrestricted": note the difference in alert timing.
14. Sign out: background notification disappears; the device's row in `push_tokens` is removed.
