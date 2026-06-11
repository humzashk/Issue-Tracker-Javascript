# LiveRates Dashboard

A live data dashboard built for [Vercel](https://vercel.com) deployment. Displays real-time crypto rates, commodity prices, sports scores, and trending entertainment — all in a dark-theme responsive UI that auto-refreshes every 5 minutes.

## Features

| Section | Data Source |
|---|---|
| Crypto Rates (top 20) | CoinGecko |
| Commodities — Gold, Silver, Copper, WTI Oil | Yahoo Finance |
| Cricket Scores | TheSportsDB |
| Football / FIFA Scores | TheSportsDB |
| Top 10 Trending Movies | Apple iTunes RSS |
| Top 10 Trending Songs | Apple iTunes RSS |

No API keys are required for the initial deployment — all data sources are free and publicly accessible.

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS — no build step
- **Backend**: Vercel Serverless Functions (Node.js ≥ 18)
- **Deployment**: Vercel

## Project Structure

```
/
├── index.html          # Dashboard UI
├── css/styles.css      # Dark theme, responsive CSS Grid
├── js/app.js           # Fetch + render logic, auto-refresh
├── api/
│   ├── crypto.js       # CoinGecko proxy
│   ├── commodities.js  # Yahoo Finance proxy
│   ├── cricket.js      # TheSportsDB
│   ├── football.js     # TheSportsDB
│   ├── movies.js       # iTunes RSS
│   └── music.js        # iTunes RSS
└── package.json
```

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import this repository
3. Leave all settings as default
4. Click **Deploy**

Vercel auto-detects the `/api` serverless functions — no configuration needed.

## Adding Premium Data Sources

To upgrade any section with a dedicated API, add the key in **Vercel → Project Settings → Environment Variables** and update the corresponding file in `/api/`:

| Variable | Used for |
|---|---|
| `TMDB_API_KEY` | Replace iTunes movies with TMDB trending |
| `CRICKET_API_KEY` | Replace TheSportsDB with a dedicated cricket API |
| `FOOTBALL_API_KEY` | Replace TheSportsDB with football-data.org |
