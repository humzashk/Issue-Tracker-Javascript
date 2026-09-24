// Karachi: today's prayer times + 7-day weather + air quality, in one call.
//
// Sources (all free, official APIs — no scraping, no keys):
//   • Prayer times — Aladhan, method 1 (University of Islamic Sciences,
//     Karachi) with Hanafi Asr, at Karachi's exact coordinates, plus the
//     ihtiyat (precautionary minutes) Pakistani timetables add — see TUNE.
//     The date is pinned to Karachi's calendar day, not the server's.
//   • Current weather — the real observation from Jinnah International
//     Airport (METAR report OPKC via NOAA's aviationweather.gov, every
//     30 min). A forecast model's "current" value can say "clear" while it
//     is actually cloudy or hazy; an observation can't.
//   • 7-day forecast — Open-Meteo (also the fallback for current weather).
//   • Air quality — Open-Meteo air-quality (US AQI, PM2.5).
// Each part fails independently: one source being down never blanks the
// others.
const LAT = 24.8607;
const LON = 67.0011;
const TZ = 'Asia/Karachi';

// Minute offsets, in Aladhan's order: Imsak,Fajr,Sunrise,Dhuhr,Asr,Maghrib,
// Sunset,Isha,Midnight. Matches the precautionary minutes on standard
// Karachi timetables (IslamicFinder / MuslimPro, same method + Hanafi):
// e.g. 24 Sep 2026 → Fajr 5:06, Dhuhr 12:26, Asr 4:46, Maghrib 6:29,
// Isha 7:44, where the raw calculation gives 5:05, 12:24, 4:46, 6:26, 7:42.
const TUNE = '0,1,0,2,0,3,0,2,0';

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
    `https://api.aladhan.com/v1/timings/${karachiDateParam()}` +
      `?latitude=${LAT}&longitude=${LON}&timezonestring=${encodeURIComponent(TZ)}` +
      `&method=1&school=1&tune=${TUNE}`
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
    method: 'Azan (start) times · Univ. of Islamic Sciences, Karachi · Hanafi Asr',
  };
}

// ── Dawat-e-Islami timetable ───────────────────────────────────────────────
// Dawat-e-Islami publishes its own Hanafi timetable for Karachi, which many
// Karachi mosques follow. There's no public API, so the page is read and
// each prayer's time is taken from the text near its name. Every value
// must land within 20 minutes of the calculated Hanafi time for that
// prayer — the same check also stops a Shafi'i Asr listed on the page
// (about an hour earlier) from being mistaken for Hanafi Asr. If any of
// the five prayers can't be read with confidence, the calculated times
// are used instead and the card says so.
const DI_URL = 'https://www.dawateislami.net/prayer-times/world/pakistan/karachi-prayer-times';
const DI_LABELS = {
  Fajr: /\bfajr\b/gi,
  Sunrise: /\b(sunrise|tulu)\b/gi,
  Dhuhr: /\b(dhuhr|zuhr|zohr|duhr)\b/gi,
  Asr: /\basr\b/gi,
  Maghrib: /\bmaghrib\b/gi,
  Isha: /\bisha\b/gi,
};

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Every time-looking token after a label occurrence, normalised to 24h
// minutes. A 12h time without AM/PM is resolved to whichever half of the
// day is closer to the reference.
function timeCandidates(text, labelRe, refMin) {
  const out = [];
  for (const m of text.matchAll(labelRe)) {
    const win = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const t = win.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i);
    if (!t) continue;
    let h = +t[1];
    const min = +t[2];
    if (h > 23 || min > 59) continue;
    const ap = (t[3] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap && h < 12 && Math.abs(h * 60 + min + 720 - refMin) < Math.abs(h * 60 + min - refMin)) h += 12;
    out.push(h * 60 + min);
  }
  return out;
}

function parseDawateIslami(html, reference) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\u003c[^>]*?\\u003e/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');

  const picked = {};
  for (const t of reference) {
    const ref = toMin(t.time);
    const best = timeCandidates(text, DI_LABELS[t.name], ref)
      .filter(v => Math.abs(v - ref) <= 20)
      .sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref))[0];
    if (best != null) picked[t.name] = fromMin(best);
  }
  const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  if (!prayers.every(n => picked[n])) {
    const err = new Error('could not read all five prayers');
    err.picked = picked;
    throw err;
  }
  return reference.map(t => ({ ...t, time: picked[t.name] ?? t.time }));
}

async function fetchDawateIslami(reference) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(DI_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseDawateIslami(await res.text(), reference);
  } finally {
    clearTimeout(timer);
  }
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

// ── Observed weather: METAR from Jinnah International (OPKC) ──────────────

// Relative humidity from temperature and dew point (Magnus formula)
function humidityFrom(t, td) {
  const f = x => Math.exp((17.625 * x) / (243.04 + x));
  return Math.round(Math.min(100, (100 * f(td)) / f(t)));
}

// NOAA heat index ("feels like") — only meaningful when hot; else air temp
function feelsLike(t, rh) {
  if (t < 27) return t;
  const F = t * 9 / 5 + 32;
  const hi = -42.379 + 2.04901523 * F + 10.14333127 * rh - 0.22475541 * F * rh
    - 0.00683783 * F * F - 0.05481717 * rh * rh + 0.00122874 * F * F * rh
    + 0.00085282 * F * rh * rh - 0.00000199 * F * F * rh * rh;
  return ((hi - 32) * 5) / 9;
}

// METAR weather/cloud groups → a WMO-style code (what the card's icons use)
// plus a plain-English label.
function conditionFrom(wx, clouds) {
  const w = String(wx || '');
  if (/TS/.test(w)) return [95, 'Thunderstorm'];
  if (/SH/.test(w) && /RA/.test(w)) return [80, 'Showers'];
  if (/RA/.test(w)) return [61, 'Rain'];
  if (/DZ/.test(w)) return [51, 'Drizzle'];
  if (/FG/.test(w)) return [45, 'Fog'];
  if (/DU|SA|DS|SS/.test(w)) return [45, 'Dust'];
  if (/HZ|FU/.test(w)) return [45, 'Haze'];
  if (/BR/.test(w)) return [45, 'Mist'];
  const order = ['CLR', 'SKC', 'NSC', 'NCD', 'CAVOK', 'FEW', 'SCT', 'BKN', 'OVC', 'OVX'];
  const cover = (clouds ?? [])
    .map(c => c.cover)
    .sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
  if (cover === 'OVC' || cover === 'OVX') return [3, 'Overcast'];
  if (cover === 'BKN') return [2, 'Mostly cloudy'];
  if (cover === 'SCT') return [2, 'Partly cloudy'];
  if (cover === 'FEW') return [1, 'Mostly clear'];
  return [0, 'Clear'];
}

function parseMetar(list) {
  const m = Array.isArray(list) ? list[0] : null;
  if (!m || !Number.isFinite(m.temp)) throw new Error('no METAR');
  const obsMs = (m.obsTime ?? 0) * 1000;
  if (!obsMs || Date.now() - obsMs > 3 * 3600 * 1000) throw new Error('METAR too old');
  const rh = Number.isFinite(m.dewp) ? humidityFrom(m.temp, m.dewp) : null;
  const [code, label] = conditionFrom(m.wxString, m.clouds);
  return {
    temp: m.temp,
    feelsLike: rh != null ? feelsLike(m.temp, rh) : m.temp,
    humidity: rh,
    wind: Number.isFinite(m.wspd) ? m.wspd * 1.852 : null, // knots → km/h
    code,
    label,
    observedAt: obsMs,
  };
}

async function fetchObservation() {
  return parseMetar(await getJSON('https://aviationweather.gov/api/data/metar?ids=OPKC&format=json'));
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
  const debug = req.query?.debug === '1';
  const [prayer, weather, air, obs] = await Promise.allSettled([
    fetchPrayer(), fetchWeather(), fetchAirQuality(), fetchObservation(),
  ]);
  const ok = r => (r.status === 'fulfilled' ? r.value : null);

  // Prefer Dawat-e-Islami's published timetable; the calculated Hanafi times
  // are the reference it's checked against and the fallback.
  const p = ok(prayer);
  let diError = null;
  if (p) {
    try {
      p.timings = await fetchDawateIslami(p.timings);
      p.method = 'Dawat-e-Islami timetable (Hanafi)';
      p.source = 'dawateislami';
    } catch (e) {
      diError = { message: e.message, picked: e.picked ?? null };
      p.method = 'Calculated · Univ. of Islamic Sciences, Karachi · Hanafi (Dawat-e-Islami unreachable)';
      p.source = 'calculated';
    }
  }

  // Prefer the real airport observation for "now"; keep the model's day/night
  // flag for the icon. Falls back to the model's current values if METAR fails.
  const w = ok(weather);
  if (w && ok(obs)) {
    w.current = { ...ok(obs), isDay: w.current.isDay, source: 'observed' };
  } else if (w) {
    w.current.source = 'model';
  }

  if (!ok(prayer) && !ok(weather)) {
    return res.status(502).json({ success: false, message: 'Karachi data is temporarily unavailable' });
  }

  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.json({
    success: true,
    data: { prayer: p, weather: ok(weather), air: ok(air) },
    ...(debug ? { debug: { dawateIslami: diError ?? 'ok' } } : {}),
  });
};

module.exports.parseMetar = parseMetar;
module.exports.parseDawateIslami = parseDawateIslami;
