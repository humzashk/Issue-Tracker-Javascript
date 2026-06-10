const COMMODITIES = [
  { id: 'gold',   symbol: 'GC=F',  name: 'Gold',            unit: 'per troy oz' },
  { id: 'silver', symbol: 'SI=F',  name: 'Silver',          unit: 'per troy oz' },
  { id: 'copper', symbol: 'HG=F',  name: 'Copper',          unit: 'per pound'   },
  { id: 'oil',    symbol: 'CL=F',  name: 'Crude Oil (WTI)', unit: 'per barrel'  },
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

module.exports = async function handler(req, res) {
  const results = await Promise.allSettled(
    COMMODITIES.map(async c => {
      const price = await fetchYahooPrice(c.symbol);
      return { id: c.id, name: c.name, unit: c.unit, price };
    })
  );

  const data = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  if (!data.length) {
    return res.status(500).json({ success: false, message: 'Could not fetch commodity prices' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({ success: true, data, source: 'Yahoo Finance' });
};
