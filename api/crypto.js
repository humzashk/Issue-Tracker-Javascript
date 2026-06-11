// Crypto rates in PKR — BTC, ETH, XRP, USDT only (CoinGecko supports
// vs_currency=pkr natively, so no manual conversion is needed).
module.exports = async function handler(req, res) {
  try {
    const url =
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=pkr&ids=bitcoin,ethereum,ripple,tether' +
      '&order=market_cap_desc&sparkline=true&price_change_percentage=24h,7d';

    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'LiveRates/1.0' },
    });

    if (!response.ok) throw new Error(`CoinGecko error: ${response.status}`);

    const data = (await response.json()).map(c => ({ ...c, currency: 'PKR' }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json({ success: true, data, source: 'CoinGecko' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
