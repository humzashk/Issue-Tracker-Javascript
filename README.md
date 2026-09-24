# LiveRates

Pakistan-focused live dashboard — markets, daily rates, Karachi essentials and trending music — installable as an app (PWA). Live at **https://issue-tracker-javascript.vercel.app**.

## Sections

| Tab | Cards | Sources |
|---|---|---|
| **Markets** | Crypto (PKR + USD, 7-day sparklines) · Market Mood · Gold, Silver & Oil · PSX KSE-100 · Predict BTC game | CoinGecko · alternative.me · gold.pk, oilprice.com, Yahoo Finance · PSX Data Portal |
| **Pakistan** | Currency converter + rates · Daily Rates (fuel, meat, grocery, produce) with charts & 30-day forecast | open.er-api.com · live fuel scrape + `data/pak-commodities.json` |
| **Karachi** | Prayer times (next-prayer countdown, Hijri date) · 7-day weather + air quality | Aladhan (Univ. of Islamic Sciences, Karachi · Hanafi) · Open-Meteo |
| **Entertainment** | Top movies · Global Top 10 · Pakistan trending (30s previews) | IMDb/OMDb · Spotify/YouTube daily charts, Apple, Deezer |

Also: search across everything, themes, zen mode, XP/achievements, and a few easter eggs. Keys: `1`–`4` sections, `R` refresh, `T` theme, `Z` zen.

## Stack

Vanilla HTML/CSS/JS (no build step) + Vercel serverless functions in `/api` (Node ≥ 18).

```
index.html            page shell (4 tabbed panels)
css/styles.css        design system + themes
js/app.js             rendering, tabs, search, game, eggs
sw.js                 service worker (offline + installable)
manifest.webmanifest  PWA manifest · icons/ app icons
api/                  one file per endpoint; _*.js are shared helpers, not endpoints
data/                 reference rates for the Daily Rates card
```

Vercel's free plan allows 12 functions; this uses 10.

## Setup

Import the repo at [vercel.com/new](https://vercel.com/new) and deploy — no configuration needed.

Optional:
- `OMDB_API_KEY` env var — adds IMDb rating + Metascore to movies.
- **Analytics**: Vercel dashboard → project → **Analytics** → Enable (free). The script is already in the page.

Most endpoints accept `?debug=1` to show which upstream source answered.
