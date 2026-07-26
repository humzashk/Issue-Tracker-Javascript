// Global trending songs — keyless.
// Waterfall: Spotify global daily chart → Deezer live chart → Apple feeds.
// Add ?debug=1 to see which sources were tried.
const C = require('./_charts.js');

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  try {
    const { rows, source, attempts } = await C.waterfall([
      { name: 'Spotify Global Daily Top 200', run: () => C.kworb('spotify/country/global_daily.html') },
      { name: 'Deezer Global Chart',          run: () => C.deezerChart() },
      { name: 'Apple Music Global',           run: () => C.appleMostPlayed('us') },
      { name: 'iTunes Top Songs',             run: () => C.itunesRss('us') },
    ]);

    const data = await C.enrichAll(rows, 10);
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({ success: true, data, source, ...(debug ? { attempts } : {}) });
  } catch (err) {
    console.error(err);
    res.status(502).json({
      success: false,
      message: 'Global chart sources are temporarily unavailable',
      ...(debug ? { attempts: err.attempts } : {}),
    });
  }
};
