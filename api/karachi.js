// Karachi: today's prayer times + 7-day weather + air quality, in one call.
//
// Sources (all free, official APIs — no scraping, no keys):
//   • Prayer times — Aladhan, method 1 (University of Islamic Sciences,
//     Karachi) with Hanafi Asr (school=1), the convention mosques in Karachi
//     follow. The date is pinned to Karachi's calendar day, not the server's.
//   • Weather — Open-Meteo forecast (current conditions + 7 days).
//   • Air quality — Open-Meteo air-quality (US AQI, PM2.5).
// Each part fails independently: one source being down never blanks the
// others.
const LAT = 24.8607;
const LON = 67.0011;
const TZ = 'Asia/Karachi';

async function getJSON(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// DD-MM-YYYY for today in Karachi
function karachiDateParam() {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: TZ }).split('-');
  return `${d}-${m}-${y}`;
}

const cleanTime = t => String(t ?? '').slice(0, 5); // "05:12 (PKT)" -> "05:12"

async function fetchPrayer() {
  const j = await getJSON(
    `https://api.aladhan.com/v1/timingsByCity/${karachiDateParam()}` +
      '?city=Karachi&country=Pakistan&method=1&school=1'
  );
  const t = j?.data?.timings;
  if (!t?.Fajr) throw new Error('no timings');
  const hijri = j.data.date?.hijri;
  return {
    date: j.data.date?.readable ?? null,
    hijri: hijri ? `${hijri.day} ${hijri.month?.en} ${hijri.year} AH` : null,
    timings: [
      { name: 'Fajr', time: cleanTime(t.Fajr) },
      { name: 'Sunrise', time: cleanTime(t.Sunrise), info: true },
      { name: 'Dhuhr', time: cleanTime(t.Dhuhr) },
      { name: 'Asr', time: cleanTime(t.Asr) },
      { name: 'Maghrib', time: cleanTime(t.Maghrib) },
      { name: 'Isha', time: cleanTime(t.Isha) },
    ],
    method: 'Univ. of Islamic Sciences, Karachi · Hanafi Asr',
  };
}

async function fetchWeather() {
  const j = await getJSON(
    'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TZ)}&forecast_days=7` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset'
  );
  const c = j?.current;
  const d = j?.daily;
  if (!c || !d?.time?.length) throw new Error('no forecast');
  return {
    current: {
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day === 1,
      time: c.time,
    },
    days: d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rain: d.precipitation_probability_max?.[i] ?? null,
      uv: d.uv_index_max?.[i] ?? null,
    })),
  };
}

async function fetchAirQuality() {
  const j = await getJSON(
    'https://air-quality-api.open-meteo.com/v1/air-quality' +
      `?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TZ)}&current=us_aqi,pm2_5`
  );
  const c = j?.current;
  if (c?.us_aqi == null) throw new Error('no aqi');
  return { aqi: Math.round(c.us_aqi), pm25: c.pm2_5 };
}

module.exports = async function handler(req, res) {
  const [prayer, weather, air] = await Promise.allSettled([fetchPrayer(), fetchWeather(), fetchAirQuality()]);
  const ok = r => (r.status === 'fulfilled' ? r.value : null);

  if (!ok(prayer) && !ok(weather)) {
    return res.status(502).json({ success: false, message: 'Karachi data is temporarily unavailable' });
  }

  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.json({
    success: true,
    data: { prayer: ok(prayer), weather: ok(weather), air: ok(air) },
  });
};
