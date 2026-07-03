// Diagnostic: shows which external fuel-rate sources are reachable from
// Vercel's servers and what values each one yields. Open /api/probe in a
// browser after deploying to see exactly which sources work — no guessing.
const { SOURCES, fetchSource } = require('./_fuel-sources.js');

module.exports = async function handler(req, res) {
  const results = await Promise.all(SOURCES.map(s => fetchSource(s, 8000)));
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    checkedAt: new Date().toISOString(),
    results: results.map(r => ({
      source: r.name,
      httpStatus: r.status,
      petrol: r.petrol ?? null,
      diesel: r.diesel ?? null,
      error: r.error ?? null,
    })),
    verdict:
      results.find(r => r.petrol && r.diesel)?.name
        ? `Live fuel data available via: ${results.find(r => r.petrol && r.diesel).name}`
        : 'No source currently reachable — reference rates will be shown instead',
  });
};
