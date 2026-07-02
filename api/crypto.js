// Crypto rates — BTC, ETH, XRP, USDT in both PKR and USD.
// Markets endpoint (PKR, with 7d sparklines) + simple/price (USD) merged.
const IDS = 'bitcoin,ethereum,ripple,tether';

module.exports = async function handler(req, res) {
  try {
    const headers = { Accept: 'application/json', 'User-Agent': 'LiveRates/1.0' };

    const [marketsRes, usdRes] = await Promise.all([
      fetch(
        'https://api.coingecko.com/api/v3/coins/markets' +
          `?vs_currency=pkr&ids=${IDS}` +
          '&order=market_cap_desc&sparkline=true&price_change_percentage=24h,7d',
        { headers }
      ),
      fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${IDS}&vs_currencies=usd`,
        { headers }
      ),
    ]);

    if (!marketsRes.ok) throw new Error(`CoinGecko error: ${marketsRes.status}`);

    const markets = await marketsRes.json();
    const usd = usdRes.ok ? await usdRes.json() : {};

    const data = markets.map(c => ({
      ...c,
      currency: 'PKR',
      usd_price: usd[c.id]?.usd ?? null,
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json({ success: true, data, source: 'CoinGecko' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
