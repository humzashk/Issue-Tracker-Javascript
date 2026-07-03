// Live exchange rates vs PKR — open.er-api.com, free, no key required.
// Returns the USD⇄PKR pair for the converter plus a set of currencies
// Pakistanis care about (remittance corridors + trade partners).
const CURRENCIES = [
  { code: 'USD', name: 'US Dollar',      flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro',           flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound',  flag: '🇬🇧' },
  { code: 'SAR', name: 'Saudi Riyal',    flag: '🇸🇦' },
  { code: 'AED', name: 'UAE Dirham',     flag: '🇦🇪' },
  { code: 'CNY', name: 'Chinese Yuan',   flag: '🇨🇳' },
  { code: 'TRY', name: 'Turkish Lira',   flag: '🇹🇷' },
];

module.exports = async function handler(req, res) {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Exchange rate API: ${response.status}`);

    const json = await response.json();
    const rates = json?.rates ?? {};
    const pkr = rates.PKR;
    if (!pkr) throw new Error('PKR rate unavailable');

    const currencies = CURRENCIES
      .filter(c => rates[c.code])
      .map(c => ({ ...c, pkr: pkr / rates[c.code] }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({
      success: true,
      data: {
        usdToPkr: pkr,
        pkrToUsd: 1 / pkr,
        updated: json.time_last_update_utc ?? null,
        currencies,
      },
      source: 'open.er-api.com',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Data source is temporarily unavailable' });
  }
};
