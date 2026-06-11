module.exports = async function handler(req, res) {
  try {
    const url =
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=20&page=1' +
      '&sparkline=false&price_change_percentage=24h';

    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'LiveRates/1.0' },
    });

    if (!response.ok) throw new Error(`CoinGecko error: ${response.status}`);

    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json({ success: true, data, source: 'CoinGecko' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
