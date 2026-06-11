// Pakistani market rates: Gold & Silver per tola (scraped from gold.pk,
// with a computed fallback), Copper per lb in PKR, Crude Oil (Brent) and
// WTI in USD.
//
// 1 tola = 11.6638038 g = exactly 0.375 troy oz — used for the fallback
// when gold.pk can't be scraped.

const TROY_OZ_PER_TOLA = 0.375;

async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LiveRates/1.0)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol}: ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  return meta?.regularMarketPrice ?? meta?.previousClose ?? null;
}

async function fetchPKRRate() {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Exchange rate API: ${res.status}`);
  const json = await res.json();
  return json?.rates?.PKR ?? null;
}

// Best-effort scrape of gold.pk for the 24k 1-tola gold rate and 1-tola
// silver rate. Page structure can change, so any failure returns null and
// the caller falls back to the computed rate.
async function scrapeGoldPk() {
  try {
    const res = await fetch('https://gold.pk/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return { gold: null, silver: null };
    const html = await res.text();

    // Look for PKR amounts near "tola" mentions, e.g. "Rs. 241,500" or "241500"
    const findRate = keyword => {
      const re = new RegExp(
        keyword + String.raw`[^]{0,400}?(?:Rs\.?|PKR)\s*([\d,]{4,})`,
        'i'
      );
      const m = html.match(re);
      if (!m) return null;
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      return Number.isFinite(n) && n > 100 ? n : null;
    };

    return {
      gold: findRate(String.raw`gold[^]{0,200}?tola|tola[^]{0,200}?gold|24k`),
      silver: findRate(String.raw`silver[^]{0,200}?tola|tola[^]{0,200}?silver`),
    };
  } catch {
    return { gold: null, silver: null };
  }
}

module.exports = async function handler(req, res) {
  const [scraped, pkrRate, goldOz, silverOz, copperLb, brent, wti] = await Promise.all([
    scrapeGoldPk(),
    fetchPKRRate().catch(() => null),
    fetchYahooPrice('GC=F').catch(() => null),
    fetchYahooPrice('SI=F').catch(() => null),
    fetchYahooPrice('HG=F').catch(() => null),
    fetchYahooPrice('BZ=F').catch(() => null),
    fetchYahooPrice('CL=F').catch(() => null),
  ]);

  const tolaFromSpot = ozPrice =>
    ozPrice != null && pkrRate ? Math.round(ozPrice * TROY_OZ_PER_TOLA * pkrRate) : null;

  const data = [
    {
      id: 'gold',
      name: 'Gold (24k)',
      unit: 'per tola',
      price: scraped.gold ?? tolaFromSpot(goldOz),
      currency: 'PKR',
      source: scraped.gold ? 'gold.pk' : 'spot price (converted)',
    },
    {
      id: 'silver',
      name: 'Silver',
      unit: 'per tola',
      price: scraped.silver ?? tolaFromSpot(silverOz),
      currency: 'PKR',
      source: scraped.silver ? 'gold.pk' : 'spot price (converted)',
    },
    {
      id: 'copper',
      name: 'Copper',
      unit: 'per pound',
      price: copperLb != null && pkrRate ? Math.round(copperLb * pkrRate) : null,
      currency: 'PKR',
      source: 'spot price (converted)',
    },
    {
      id: 'oil-brent',
      name: 'Crude Oil (Brent)',
      unit: 'per barrel',
      price: brent,
      currency: 'USD',
      source: 'Yahoo Finance',
    },
    {
      id: 'oil-wti',
      name: 'Crude Oil (WTI)',
      unit: 'per barrel',
      price: wti,
      currency: 'USD',
      source: 'Yahoo Finance',
    },
  ].filter(c => c.price != null);

  if (!data.length) {
    return res.status(500).json({ success: false, message: 'Could not fetch commodity prices' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({ success: true, data, source: 'gold.pk / Yahoo Finance / ExchangeRate API' });
};
