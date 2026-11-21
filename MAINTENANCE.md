# LiveRates — Maintenance Guide

How to keep the site healthy with no developer around. Everything here can be done from the GitHub website on a phone or laptop: no tools to install and nothing to pay for.

## 1. What updates by itself

| On the site | Comes from | How often | If the source breaks |
|---|---|---|---|
| Daily Rates (24 weekly items) | Pakistan Bureau of Statistics weekly report (SPI), Karachi average | every Thursday/Friday | shows a saved PBS copy, labelled |
| Petrol & diesel | 5 fuel sites; newest effective date wins | as notified (often daily) | falls back to PBS's weekly figure |
| Gold & silver | All-Pakistan Sarafa Association rate via Business Recorder | every trading day | gold.pk + pakgold.net, then international price, labelled |
| Oil, copper | CNBC / Yahoo / Stooq futures | live | — |
| Currency | open.er-api.com | daily | — |
| PSX KSE-100 | PSX Data Portal (Yahoo backup) | live | — |
| Crypto, Market Mood | CoinGecko, alternative.me | live | — |
| Prayer times, Ramadan | Dawat-e-Islami timetable; Aladhan as reference | daily | calculated Hanafi times |
| Weather | Open-Meteo + Karachi airport observation | live | forecast model |
| Load-shedding | K-Electric's schedule PDF, found on ke.com.pk | whenever KE publishes | saved KE copy, labelled |
| **Gas hours** | **SSGC — only published as a picture** | **⚠️ manual, see §3** | card warns visitors |

The code keeps no database. Every visit reads the sources live, and the CDN caches the answers for a few minutes to a few hours.

## 2. The daily health check (your early-warning system)

Every day at 6:23 PM Karachi time, GitHub runs **Site health check** (free for public repositories). It opens the live site, checks every rate, and:

- **all good** → does nothing. No email, no noise.
- **something wrong** → opens **one** issue titled **🩺 LiveRates health check** listing each problem and how to fix it. GitHub emails you. While problems remain, the issue updates itself, and you get another email only when the list of problems changes.
- **fixed again** → it comments "All checks pass again" and closes the issue by itself.

Icons in the issue:
- 🔴 **Broken**: visitors see something wrong or missing. Look soon.
- 🛠️ **Needs a small manual update**: usually SSGC gas hours (§3). Takes about 2 minutes.
- 🟡 **Degraded**: still working, using a backup source. Fix when convenient; often it fixes itself within a day.

To run the check yourself: repository → **Actions** tab → **Site health check** → **Run workflow**.

The check re-enables itself on every run, so GitHub's "no activity in 60 days" rule won't switch it off.

## 3. Updating the gas hours (the one manual job)

When the health check says **"SSGC has posted a new notice"** (or the schedule ended):

1. Open the picture linked in the issue (or ssgc.com.pk) and note the new times.
2. On GitHub, open `data/utilities.json` and click the ✏️ pencil (Edit).
3. Change the times. Use 24-hour format: `"18:00"` is 6 PM. Keep the same shape:

```json
{
  "gas": {
    "announced": "2027-03-01",
    "validUntil": "2027-10-31",
    "note": "SSGC summer schedule for homes in Sindh and Balochistan",
    "image": "https://www.ssgc.com.pk/web/wp-content/uploads/2027/03/the_new_picture.webp",
    "slots": [
      { "label": "Breakfast", "start": "06:30", "end": "09:00" },
      { "label": "Lunch", "start": "12:00", "end": "14:30" },
      { "label": "Dinner", "start": "18:00", "end": "21:00" }
    ]
  }
}
```

- `image` must be **the exact picture link from the issue**. That's how the site knows you've seen the latest notice; the warning disappears once it matches.
- `validUntil` is the last day the schedule applies. If SSGC gives no end date, use a date about 4 months ahead.
- Add or remove `slots` as needed. For 24-hour supply, use one slot: `{ "label": "All day", "start": "00:00", "end": "23:59" }`.

4. Click **Commit changes**. Vercel redeploys in about 1 minute. To check, run the health check (§2).

## 4. Quick fixes

**Something looks wrong after a change → roll back.** vercel.com → the project → **Deployments** → find the last good one → ⋯ → **Promote to Production**. This is instant and safe.

**Look under the hood.** Add `?debug=1` to an endpoint to see exactly what each source returned:
- `/api/pakcom?debug=1`: PBS weeks found, every fuel source's reading
- `/api/commodities?debug=1`: association rates, dealer boards, oil feeds
- `/api/utilities?debug=1`: KE PDF used, SSGC notice check
- `/api/karachi?debug=1`: Dawat-e-Islami and weather status

**A fuel site broke (🟡 "only one source works").** Nothing to do urgently: the site keeps working on the remaining sources. If you want, in `api/_fuel-sources.js` you can delete the broken source's `{ name: …, url: …, parse … }` block. Never add a site unless it shows the **effective date** of its price.

**Gold shows "dealer boards" for several days.** Business Recorder changed the wording of its daily gold story. Prices are still close to the official rate. This needs a developer to adjust `parseAssociationItem` in `api/commodities.js`.

**PBS stuck on an old week for over 2 weeks.** Check pbs.gov.pk → What's New. If the weekly post exists, PBS changed its file naming and a developer needs to adjust `api/_spi.js`. Until then the card keeps showing the last week it read, labelled with its date.

**KE "saved copy" for over a week.** KE changed its page. The load-shed list stays usable, just possibly out of date. Visitors can check ke.com.pk or call 118.

## 5. What to expect over the next months

| When | What happens | Action needed |
|---|---|---|
| Every week | New PBS prices appear, charts grow by a week | none |
| ~Dec–Feb | Winter gas load management continues | none |
| **~8 Feb 2027** | **Ramadan starts** (calculated; follows the moon sighting). Prayer card switches to Sehri/Iftar countdowns | none. SSGC usually issues special Sehri/Iftar gas hours → the health check flags the new notice → §3 |
| **28 Feb 2027** | Saved winter gas schedule ends; card tells visitors to check SSGC | update gas hours (§3) when SSGC announces |
| ~9–10 Mar 2027 | Eid-ul-Fitr; PBS may skip a week | none |
| Apr–Jun 2027 | Summer: KE load-shedding usually increases, and KE publishes a new schedule PDF | none; picked up automatically |
| June 2027 | Federal budget: electricity/gas tariffs, fuel levy and tax changes flow into PBS and fuel prices | none |
| Any time | A source changes its website | the health check tells you (§2) |

## 6. Free-plan limits (all comfortably within)

- **Vercel Hobby**: 12 serverless functions allowed, 11 used. Don't add new files to `/api` unless their name starts with `_` (helpers don't count).
- **GitHub Actions**: free and unlimited for public repositories. The health check uses about 1 minute a day.
- **No API keys, no paid services.** Every source is a public website or a free public API.

## 7. When you have a developer (or Claude) again

Paste this to get going fast:

> Read MAINTENANCE.md and the open "🩺 LiveRates health check" issue, then fix whatever it lists. The project is a vanilla JS + Vercel serverless site; sources and fallbacks are described in the comments at the top of each file in /api.
