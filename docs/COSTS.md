# Running costs (estimate)

Prices are list prices as of October 2026 in US dollars, from memory of the providers' pricing pages; check them before budgeting. They exclude tax and your own time.

## Fixed costs

| Item | Cost |
|---|---|
| Apple Developer Program | US$99 per year |
| Google Play developer account | US$25 once |
| Domain for the privacy policy and support pages | ~US$15 per year (hosting a static page can be free) |
| Legal review of terms, privacy policy, guidelines | One-off; varies widely by country (often US$500–3,000) |

## Monthly costs by size

"MAU" is monthly active members.

| Service | Up to ~1k MAU (launch) | ~10k MAU | ~50k MAU |
|---|---|---|---|
| Supabase Pro (database, auth, storage, realtime, functions) | US$25 (includes small compute credits) | US$25 + compute upgrade ~US$15 = ~US$40 | ~US$25 + ~US$60 compute + storage/egress overage ~US$30 = ~US$115 |
| Email (Resend/Postmark/SES) | Free tier | ~US$20 | ~US$20–35 |
| Expo EAS builds | Free tier (slow queue, limited builds) | Starter ~US$19 | Production ~US$199 if you build often; otherwise Starter |
| Expo push notifications | Free | Free | Free |
| Maps: Apple (iOS) | Free | Free | Free |
| Maps: Google Maps SDK for Android | Free for mobile map loads (billing account required) | Free | Free |
| Town search geocoding | Phone's geocoder, free; Nominatim fallback free at low volume | Consider a paid geocoder (~US$0–20) | ~US$20–50 |
| Image moderation (optional, recommended) | e.g. Google Vision SafeSearch: first 1,000 images/month free, then ~US$1.50 per 1,000 | ~US$10–30 | ~US$50–150 |
| Crash reporting (optional, Sentry) | Free tier | Free–US$26 | ~US$26–80 |
| **Total (approx.)** | **US$25–50** | **US$80–150** | **US$250–600** |

## What drives the bill

* **Photos:** each chat or post photo is resized to 1,600 px JPEG (~200–400 KB). 10k members sharing a few photos a week is roughly 10–20 GB a month of new storage. Supabase Pro includes 100 GB storage and 250 GB egress; beyond that it is roughly US$0.02 per GB stored and US$0.09 per GB served.
* **Realtime chat:** Pro includes 500 concurrent connections. Only an open chat screen or inbox holds a connection. Many simultaneous users need a higher limit (paid add-on).
* **Location reports:** small rows, one per member, replaced on every report; negligible storage, but each report runs a geospatial query. At ~50k members with alerts on, move to a larger compute size and watch database CPU.
* **Push:** Expo, APNs and FCM are free.

## No in-app revenue

The app has no payments, ads or subscriptions. Introducing any of them needs a separate design (and, for digital goods, Apple and Google in-app purchase rules).
