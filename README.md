# LiveRates

Pakistan-focused live dashboard — markets, daily rates, Karachi essentials and trending music — installable as an app (PWA). Live at **https://issue-tracker-javascript.vercel.app**.

## Sections

| Tab | Cards | Sources |
|---|---|---|
| **Markets** | Crypto (PKR + USD, 7-day sparklines) · Market Mood · Gold (24K + 22K/21K/18K), Silver & Oil · PSX KSE-100 · Predict BTC game | CoinGecko · alternative.me · All-Pakistan Sarafa Association daily rate via Business Recorder (fallback: gold.pk, pakgold.net), ICE/NYMEX futures (CNBC + Stooq + Yahoo consensus) · PSX Data Portal |
| **Pakistan** | Currency converter + rates · Daily Rates (26 Karachi essentials) with this week's biggest movers, a monthly basket cost vs last month & last year (typical family, or your own items), share as text or as a picture, a year of weekly history, zoomable charts & 30-day forecast · Calculators: zakat (Hanafi nisab from today's gold & silver), gold value by karat & weight, fuel trip cost | open.er-api.com · Pakistan Bureau of Statistics weekly SPI (Karachi average, read live from the Excel annexes) + today's notified petrol/diesel price (newest effective date across 5 sites) · Sarafa Association gold/silver |
| **Karachi** | Prayer times (next-azan countdown, Hijri date, Ramadan countdown and Sehri/Iftar mode) · 7-day weather + air quality · Power & Gas: K-Electric load-shedding by feeder (on/off now, next outage) and SSGC gas supply hours | Aladhan + Dawat-e-Islami timetable (Hanafi) · Open-Meteo, airport METAR · K-Electric schedule PDF (read live with `unpdf`) · SSGC notice (hours in `data/utilities.json`, new notices detected) |
| **Entertainment** | Top movies · Global Top 10 · Pakistan trending (30s previews) | IMDb/OMDb · Spotify/YouTube daily charts, Apple, Deezer |

Also: search across everything (including the calculators), app shortcuts when installed (long-press the icon → Daily Rates / Prayer Times / Markets), themes, zen mode, XP/achievements, and a few easter eggs. Keys: `1`–`4` sections, `R` refresh, `T` theme, `Z` zen.

## Stack

Vanilla HTML/CSS/JS (no build step) + Vercel serverless functions in `/api` (Node ≥ 22). One free dependency: `unpdf`, to read K-Electric's schedule PDF.

```
index.html            page shell (4 tabbed panels)
css/styles.css        design system + themes
js/app.js             rendering, tabs, search, game, eggs
sw.js                 service worker (offline + installable)
manifest.webmanifest  PWA manifest · icons/ app icons
api/                  one file per endpoint; _*.js are shared helpers, not endpoints
data/                 saved PBS + K-Electric snapshots (used only if the source is unreachable), SSGC gas hours
```

Vercel's free plan allows 12 functions; this uses 11. Everything runs on free tiers — no paid services or API keys.

## Setup

Import the repo at [vercel.com/new](https://vercel.com/new) and deploy — no configuration needed.

Optional:
- `OMDB_API_KEY` env var — adds IMDb rating + Metascore to movies.
- **Analytics**: Vercel dashboard → project → **Analytics** → Enable (free). The script is already in the page.

Most endpoints accept `?debug=1` to show which upstream source answered.
