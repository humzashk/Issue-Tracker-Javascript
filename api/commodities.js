// Gold, Silver, Copper only — prices converted to PKR
const COMMODITIES = [
  { id: 'gold',   symbol: 'GC=F', name: 'Gold',   unit: 'per troy oz' },
  { id: 'silver', symbol: 'SI=F', name: 'Silver', unit: 'per troy oz' },
  { id: 'copper', symbol: 'HG=F', name: 'Copper', unit: 'per pound'   },
];

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

module.exports = async function handler(req, res) {
  const [pricesResult, pkrResult] = await Promise.allSettled([
    Promise.allSettled(
      COMMODITIES.map(async c => {
        const priceUSD = await fetchYahooPrice(c.symbol);
        return { id: c.id, name: c.name, unit: c.unit, priceUSD };
      })
    ),
    fetchPKRRate(),
  ]);

  const pkrRate = pkrResult.status === 'fulfilled' ? pkrResult.value : null;
  const priceResults = pricesResult.status === 'fulfilled' ? pricesResult.value : [];

  const data = priceResults
    .filter(r => r.status === 'fulfilled')
    .map(r => {
      const c = r.value;
      return {
        id: c.id,
        name: c.name,
        unit: c.unit,
        price: c.priceUSD != null && pkrRate ? Math.round(c.priceUSD * pkrRate) : null,
        priceUSD: c.priceUSD,
        currency: 'PKR',
        pkrRate,
      };
    });

  if (!data.length) {
    return res.status(500).json({ success: false, message: 'Could not fetch commodity prices' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({ success: true, data, source: 'Yahoo Finance + ExchangeRate API' });
};
