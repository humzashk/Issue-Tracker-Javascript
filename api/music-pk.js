// Pakistan trending songs — keyless.
// Waterfall: Spotify PK daily chart (rebuilt daily by kworb) → YouTube PK
// chart → Apple's Pakistan storefront feeds → freshest YouTube uploads →
// year-ranked Deezer playlist. First source that answers wins.
// Add ?debug=1 to see every source that was tried and why it failed.
const C = require('./_charts.js');

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  try {
    const { rows, source, attempts } = await C.waterfall([
      { name: 'Spotify Pakistan Daily Top 200', run: () => C.kworb('spotify/country/pk_daily.html') },
      { name: 'YouTube Pakistan Daily',         run: () => C.kworb('youtube/insights/pk_daily.html') },
      { name: 'Apple Music Pakistan',           run: () => C.appleMostPlayed('pk') },
      { name: 'iTunes Pakistan Top Songs',      run: () => C.itunesRss('pk') },
      { name: 'YouTube — newest Pakistani releases', run: () => C.youtubeSearchTitles('new pakistani songs this week') },
      { name: 'Deezer Pakistani playlist',      run: () => C.deezerPlaylist('pakistani hits') },
    ]);

    const data = await C.enrichAll(rows, 10);
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({ success: true, data, source, ...(debug ? { attempts } : {}) });
  } catch (err) {
    console.error(err);
    res.status(502).json({
      success: false,
      message: 'Pakistan chart sources are temporarily unavailable',
      ...(debug ? { attempts: err.attempts } : {}),
    });
  }
};
