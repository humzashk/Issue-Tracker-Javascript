// Live USD ⇄ PKR exchange rate — open.er-api.com, free, no key required
module.exports = async function handler(req, res) {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Exchange rate API: ${response.status}`);

    const json = await response.json();
    const pkr = json?.rates?.PKR;
    if (!pkr) throw new Error('PKR rate unavailable');

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({
      success: true,
      data: { usdToPkr: pkr, pkrToUsd: 1 / pkr, updated: json.time_last_update_utc ?? null },
      source: 'open.er-api.com',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
