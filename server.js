require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── 날씨 코드 매핑 ───────────────────────────────────────────────────────────
const PTY_INFO = {
  0: { description: '맑음',          icon: '☀️',  theme: 'clear'   },
  1: { description: '비',            icon: '🌧️', theme: 'rain'    },
  2: { description: '비/눈',         icon: '🌨️', theme: 'sleet'   },
  3: { description: '눈',            icon: '❄️',  theme: 'snow'    },
  4: { description: '소나기',        icon: '🌦️', theme: 'rain'    },
  5: { description: '이슬비',        icon: '🌦️', theme: 'drizzle' },
  6: { description: '빗방울/눈날림', icon: '🌧️', theme: 'sleet'   },
  7: { description: '눈날림',        icon: '🌨️', theme: 'snow'    },
};

const SKY_INFO = {
  1: { description: '맑음',     icon: '☀️',  theme: 'clear'    },
  3: { description: '구름많음', icon: '⛅',  theme: 'cloudy'   },
  4: { description: '흐림',     icon: '☁️',  theme: 'overcast' },
};

function getWeatherInfo(sky, pty) {
  if (pty && pty !== 0) return PTY_INFO[pty] ?? PTY_INFO[0];
  return SKY_INFO[sky] ?? SKY_INFO[1];
}

// ── LCC 격자 변환 (위경도 → NX, NY) ─────────────────────────────────────────
// 기상청 공식 Lambert Conformal Conic 투영 파라미터
function latLngToGrid(lat, lng) {
  const RE    = 6371.00877;
  const GRID  = 5.0;
  const SLAT1 = 30.0 * Math.PI / 180;
  const SLAT2 = 60.0 * Math.PI / 180;
  const OLON  = 126.0 * Math.PI / 180;
  const OLAT  = 38.0  * Math.PI / 180;
  const XO    = 43;
  const YO    = 136;

  const sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) /
             Math.log(Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) /
                      Math.tan(Math.PI * 0.25 + SLAT1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + SLAT1 * 0.5), sn) *
             Math.cos(SLAT1) / sn;
  const ro = RE / GRID * sf /
             Math.pow(Math.tan(Math.PI * 0.25 + OLAT * 0.5), sn);

  const ra = RE / GRID * sf /
             Math.pow(Math.tan(Math.PI * 0.25 + lat * Math.PI / 180 * 0.5), sn);
  let theta = lng * Math.PI / 180 - OLON;
  if (theta >  Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

// ── 지오코딩 (Nominatim, 결과 인메모리 캐시) ─────────────────────────────────
const geoCache = new Map();

async function geocodeLocation(query) {
  const key = query.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);

  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&countrycodes=kr&format=json&limit=1&addressdetails=1&accept-language=ko`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'SkyPeek-WeatherApp/1.0 (leeandrew000770@gmail.com)' },
  });
  if (!res.ok) throw new Error('위치 검색 서비스에 일시적으로 접근할 수 없습니다.');

  const data = await res.json();
  if (!data.length) throw new Error(`'${query}' 위치를 찾을 수 없습니다. 다른 이름으로 검색해보세요.`);

  const { lat, lon, address, display_name } = data[0];
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lon);

  // 대한민국 영역 외 차단 (위도 33~39, 경도 124~132)
  if (latNum < 33.0 || latNum > 39.5 || lngNum < 124.0 || lngNum > 132.0) {
    throw new Error(`'${query}'은(는) 대한민국 지역이 아닌 것 같습니다.`);
  }

  // 표시 이름: 읍/면/동/구/시 순으로 가장 구체적인 이름 선택
  const name =
    address?.quarter     ||
    address?.suburb      ||
    address?.village     ||
    address?.town        ||
    address?.city_district ||
    address?.borough     ||
    address?.city        ||
    address?.county      ||
    display_name.split(',')[0].trim();

  const { nx, ny } = latLngToGrid(latNum, lngNum);
  const result = { lat: latNum, lng: lngNum, nx, ny, name };
  geoCache.set(key, result);
  return result;
}

// ── 기준 시각 계산 ───────────────────────────────────────────────────────────
function getBaseDateTime() {
  const pad = (n) => String(n).padStart(2, '0');
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  if (kst.getUTCMinutes() < 45) kst.setUTCHours(kst.getUTCHours() - 1);
  return {
    base_date: `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`,
    base_time: `${pad(kst.getUTCHours())}00`,
  };
}

function getForecastBaseDateTime() {
  const pad = (n) => String(n).padStart(2, '0');
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const h = kst.getUTCHours(), m = kst.getUTCMinutes();
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  let baseHour = null;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (h > slots[i] || (h === slots[i] && m >= 10)) { baseHour = slots[i]; break; }
  }
  if (baseHour === null) { kst.setUTCDate(kst.getUTCDate() - 1); baseHour = 23; }
  return {
    base_date: `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`,
    base_time: `${pad(baseHour)}00`,
  };
}

// ── KMA API Hub 기본 URL ──────────────────────────────────────────────────────
const KMA_BASE = 'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0';

function kmaUrl(endpoint, authKey, extra) {
  return `${KMA_BASE}/${endpoint}?authKey=${authKey}&pageNo=1&numOfRows=1000&dataType=JSON&${extra}`;
}

app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/weather ─────────────────────────────────────────────────────────
app.get('/api/weather', async (req, res) => {
  const query   = req.query.city?.trim();
  const authKey = process.env.KMA_API_KEY;

  if (!query)   return res.status(400).json({ error: '도시/지역 이름을 입력해주세요.' });
  if (!authKey) return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });

  try {
    const loc = await geocodeLocation(query);
    const { base_date, base_time } = getBaseDateTime();

    const url = kmaUrl('getUltraSrtNcst', authKey,
      `base_date=${base_date}&base_time=${base_time}&nx=${loc.nx}&ny=${loc.ny}`);

    const response = await fetch(url);
    const data = await response.json();

    const header = data?.response?.header;
    if (!header || header.resultCode !== '00') {
      return res.status(502).json({ error: header?.resultMsg || '기상청 API 호출 실패' });
    }

    const items = data.response.body.items.item;
    const get   = (cat) => {
      const item = items.find((i) => i.category === cat);
      return item ? parseFloat(item.obsrValue) : null;
    };

    const pty = get('PTY') ?? 0;
    const info = PTY_INFO[pty] ?? PTY_INFO[0];

    res.json({
      city: loc.name,
      lat: loc.lat, lng: loc.lng,
      base_date, base_time,
      temp:          get('T1H'),
      humidity:      get('REH'),
      wind_speed:    get('WSD'),
      wind_dir:      get('VEC'),
      precipitation: get('RN1'),
      pty,
      description: info.description,
      icon:        info.icon,
      theme:       info.theme,
    });
  } catch (err) {
    console.error('[/api/weather]', err.message);
    const status = err.message.includes('찾을 수 없') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /api/forecast ────────────────────────────────────────────────────────
app.get('/api/forecast', async (req, res) => {
  const query   = req.query.city?.trim();
  const authKey = process.env.KMA_API_KEY;

  if (!query)   return res.status(400).json({ error: '도시/지역 이름을 입력해주세요.' });
  if (!authKey) return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });

  try {
    const loc = await geocodeLocation(query);
    const { base_date, base_time } = getForecastBaseDateTime();

    const url = kmaUrl('getVilageFcst', authKey,
      `base_date=${base_date}&base_time=${base_time}&nx=${loc.nx}&ny=${loc.ny}`);

    const response = await fetch(url);
    const data = await response.json();

    const header = data?.response?.header;
    if (!header || header.resultCode !== '00') {
      return res.status(502).json({ error: header?.resultMsg || '기상청 예보 API 호출 실패' });
    }

    const items = data.response.body.items.item;

    // 날짜+시간 키로 카테고리 값 집계
    const byDT = {};
    for (const item of items) {
      const k = `${item.fcstDate}_${item.fcstTime}`;
      if (!byDT[k]) byDT[k] = { date: item.fcstDate, time: item.fcstTime };
      byDT[k][item.category] = item.fcstValue;
    }

    const sorted = Object.values(byDT).sort((a, b) =>
      `${a.date}${a.time}` < `${b.date}${b.time}` ? -1 : 1
    );

    const hourly = sorted.map((slot) => {
      const sky  = parseInt(slot.SKY ?? 1);
      const pty  = parseInt(slot.PTY ?? 0);
      const info = getWeatherInfo(sky, pty);
      return {
        date: slot.date, time: slot.time,
        temp: slot.TMP !== undefined ? parseFloat(slot.TMP) : null,
        sky, pty,
        pop:  slot.POP !== undefined ? parseInt(slot.POP) : null,
        icon: info.icon, description: info.description, theme: info.theme,
      };
    });

    // 일별 집계
    const byDate = {};
    for (const slot of sorted) {
      const d = slot.date;
      if (!byDate[d]) byDate[d] = { date: d, temps: [], skys: [], ptys: [], pops: [] };
      if (slot.TMP !== undefined) byDate[d].temps.push(parseFloat(slot.TMP));
      if (slot.TMX !== undefined) byDate[d].tmx = parseFloat(slot.TMX);
      if (slot.TMN !== undefined) byDate[d].tmn = parseFloat(slot.TMN);
      if (slot.SKY !== undefined) byDate[d].skys.push(parseInt(slot.SKY));
      if (slot.PTY !== undefined) byDate[d].ptys.push(parseInt(slot.PTY));
      if (slot.POP !== undefined) byDate[d].pops.push(parseInt(slot.POP));
    }

    const daily = Object.values(byDate).map((d) => {
      const minTemp = d.tmn ?? (d.temps.length ? Math.min(...d.temps) : null);
      const maxTemp = d.tmx ?? (d.temps.length ? Math.max(...d.temps) : null);
      const maxPop  = d.pops.length ? Math.max(...d.pops) : 0;
      const sky     = d.skys.length ? d.skys[Math.floor(d.skys.length / 2)] : 1;
      const pty     = d.ptys.find((p) => p !== 0) ?? 0;
      const info    = getWeatherInfo(sky, pty);
      return { date: d.date, min_temp: minTemp, max_temp: maxTemp, sky, pty, pop: maxPop, icon: info.icon, description: info.description };
    });

    res.json({ city: loc.name, lat: loc.lat, lng: loc.lng, hourly, daily });
  } catch (err) {
    console.error('[/api/forecast]', err.message);
    const status = err.message.includes('찾을 수 없') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sky Peek 서버 실행 중: http://localhost:${PORT}`);
});
