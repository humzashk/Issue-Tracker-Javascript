// Crypto Fear & Greed Index — alternative.me, free, no key required
module.exports = async function handler(req, res) {
  try {
    const response = await fetch('https://api.alternative.me/fng/?limit=2', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Fear & Greed API error: ${response.status}`);

    const json = await response.json();
    const [today, yesterday] = json?.data ?? [];
    if (!today) throw new Error('No index data returned');

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.json({
      success: true,
      data: {
        value: parseInt(today.value, 10),
        label: today.value_classification,
        yesterdayValue: yesterday ? parseInt(yesterday.value, 10) : null,
      },
      source: 'alternative.me',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
