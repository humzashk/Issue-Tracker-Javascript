// Reels / viral trending audio — keyless.
//
// Spotify's Viral 50 is the chart that actually tracks songs blowing up on
// Reels and TikTok (it is share/discovery driven, not stream-count driven),
// so it leads the waterfall instead of a hand-made playlist that goes stale.
// Add ?debug=1 to see which sources were tried.
const C = require('./_charts.js');

module.exports = async function handler(req, res) {
  const debug = req.query?.debug === '1';
  try {
    const { rows, source, attempts } = await C.waterfall([
      { name: 'Spotify Viral 50 — Global',    run: () => C.kworb('spotify/country/global_viral.html') },
      { name: 'Spotify Viral 50 — Pakistan',  run: () => C.kworb('spotify/country/pk_viral.html') },
      { name: 'YouTube — viral shorts audio', run: () => C.youtubeSearchTitles('viral reels songs this week') },
      { name: 'Deezer Global Chart',          run: () => C.deezerChart() },
      { name: 'Deezer viral playlist',        run: () => C.deezerPlaylist('viral hits reels') },
    ]);

    const data = await C.enrichAll(rows, 10);
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({ success: true, data, source, ...(debug ? { attempts } : {}) });
  } catch (err) {
    console.error(err);
    res.status(502).json({
      success: false,
      message: 'Viral chart sources are temporarily unavailable',
      ...(debug ? { attempts: err.attempts } : {}),
    });
  }
};
