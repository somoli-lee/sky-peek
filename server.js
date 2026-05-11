const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

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

const AIR_GRADE = { 1: '좋음', 2: '보통', 3: '나쁨', 4: '매우나쁨' };

// 전국 지도 주요 도시
const MAP_CITIES = [
  { name: '서울',   lat: 37.5665, lng: 126.9780 },
  { name: '인천',   lat: 37.4563, lng: 126.7052 },
  { name: '수원',   lat: 37.2636, lng: 127.0286 },
  { name: '문산',   lat: 37.8636, lng: 126.7956 },
  { name: '춘천',   lat: 37.8813, lng: 127.7300 },
  { name: '강릉',   lat: 37.7519, lng: 128.8761 },
  { name: '울릉도', lat: 37.4876, lng: 130.9057 },
  { name: '대전',   lat: 36.3504, lng: 127.3845 },
  { name: '청주',   lat: 36.6424, lng: 127.4890 },
  { name: '전주',   lat: 35.8242, lng: 127.1480 },
  { name: '광주',   lat: 35.1595, lng: 126.8526 },
  { name: '대구',   lat: 35.8714, lng: 128.6014 },
  { name: '부산',   lat: 35.1796, lng: 129.0756 },
  { name: '제주',   lat: 33.4996, lng: 126.5312 },
];
let mapCache = null;
let mapCacheTime = 0;
const MAP_CACHE_TTL = 15 * 60 * 1000;

// 에어코리아 시도명 매핑 (Nominatim state/city → sidoName)
const SIDO_MAP = {
  '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구',
  '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전',
  '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기',
  '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북',
  '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북',
  '전라남도': '전남', '경상북도': '경북', '경상남도': '경남',
  '제주특별자치도': '제주',
};

// ── 지오코딩 (Nominatim, 결과 인메모리 캐시) ─────────────────────────────────
const geoCache = new Map();
const GEO_CACHE_MAX = 500;

function geoCacheSet(key, value) {
  if (geoCache.size >= GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
  geoCache.set(key, value);
}

function buildNominatimUrl(query, limit) {
  return (
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&countrycodes=kr&format=json&limit=${limit}&addressdetails=1&accept-language=ko`
  );
}

function isInKorea(lat, lng) {
  return lat >= 33.0 && lat <= 39.5 && lng >= 124.0 && lng <= 132.0;
}

function extractLocationInfo(address, display_name) {
  const name =
    address?.quarter       ||
    address?.suburb        ||
    address?.village       ||
    address?.town          ||
    address?.city_district ||
    address?.borough       ||
    address?.city          ||
    address?.county        ||
    display_name.split(',')[0].trim();
  const stateRaw = address?.province || address?.state || address?.city || '';
  const sidoName = SIDO_MAP[stateRaw] ?? stateRaw.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '').trim();
  return { name, sidoName };
}

async function geocodeLocation(query) {
  const key = query.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);

  const res = await fetch(buildNominatimUrl(query, 1), {
    headers: { 'User-Agent': 'SkyPeek-WeatherApp/1.0 (leeandrew000770@gmail.com)' },
  });
  if (!res.ok) throw new Error('위치 검색 서비스에 일시적으로 접근할 수 없습니다.');

  const data = await res.json();
  if (!data.length) throw new Error(`'${query}' 위치를 찾을 수 없습니다. 다른 이름으로 검색해보세요.`);

  const { lat, lon, address, display_name } = data[0];
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lon);

  if (!isInKorea(latNum, lngNum)) {
    throw new Error(`'${query}'은(는) 대한민국 지역이 아닌 것 같습니다.`);
  }

  const { name, sidoName } = extractLocationInfo(address, display_name);
  const { nx, ny } = latLngToGrid(latNum, lngNum);
  const result = { lat: latNum, lng: lngNum, nx, ny, name, sidoName };
  geoCacheSet(key, result);
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

// ── 기상청 data.go.kr API ─────────────────────────────────────────────────────
const KMA_BASE = 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

function kmaUrl(endpoint, authKey, extra) {
  return `${KMA_BASE}/${endpoint}?serviceKey=${authKey}&pageNo=1&numOfRows=1000&dataType=JSON&${extra}`;
}

app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/geocode ─────────────────────────────────────────────────────────
app.get('/api/geocode', async (req, res) => {
  const query = req.query.q?.trim();
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });

  try {
    const resp = await fetch(buildNominatimUrl(query, 5), {
      headers: { 'User-Agent': 'SkyPeek-WeatherApp/1.0 (leeandrew000770@gmail.com)' },
    });
    if (!resp.ok) throw new Error('위치 검색 서비스에 일시적으로 접근할 수 없습니다.');

    const data = await resp.json();

    const candidates = data
      .filter((item) => isInKorea(parseFloat(item.lat), parseFloat(item.lon)))
      .map((item) => {
        const { lat: latStr, lon, address, display_name } = item;
        const latNum = parseFloat(latStr);
        const lngNum = parseFloat(lon);
        const { name, sidoName } = extractLocationInfo(address, display_name);

        const parts = display_name.split(',').map((s) => s.trim())
          .filter((s) => s && s !== '대한민국');
        const region = parts.slice(1, 4).join(' · ');

        const cacheKey = `${latNum},${lngNum}`;
        const { nx, ny } = latLngToGrid(latNum, lngNum);
        geoCacheSet(cacheKey, { lat: latNum, lng: lngNum, nx, ny, name, sidoName });

        return { name, region, cacheKey, lat: latNum, lng: lngNum };
      });

    res.json(candidates);
  } catch (err) {
    console.error('[/api/geocode]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    const uvUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${loc.lat}&longitude=${loc.lng}` +
      `&current=uv_index&timezone=Asia%2FSeoul`;

    const [response, uvRes] = await Promise.all([
      fetch(url),
      fetch(uvUrl).catch(() => null),
    ]);
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

    let uvIndex = null;
    if (uvRes) {
      try {
        const uvData = await uvRes.json();
        const raw = uvData?.current?.uv_index;
        if (raw !== null && raw !== undefined) uvIndex = Math.round(raw * 10) / 10;
      } catch { /* UV 실패 시 null 유지 */ }
    }

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
      uv_index:    uvIndex,
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

// ── GET /api/air ─────────────────────────────────────────────────────────────
app.get('/api/air', async (req, res) => {
  const query   = req.query.city?.trim();
  // 에어코리아(data.go.kr)는 별도 키 사용, 없으면 KMA 키로 시도
  const authKey = process.env.AIR_API_KEY || process.env.KMA_API_KEY;

  if (!query)   return res.status(400).json({ error: '도시/지역 이름을 입력해주세요.' });
  if (!authKey) return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });

  try {
    const loc      = await geocodeLocation(query);
    const sidoName = loc.sidoName;

    if (!sidoName) return res.status(400).json({ error: '시도 정보를 확인할 수 없습니다.' });

    // 1단계: 시도별 API → 대표 측정소명 + PM10/통합지수
    const sidoUrl =
      `http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` +
      `?serviceKey=${authKey}&returnType=json&numOfRows=1&pageNo=1` +
      `&sidoName=${encodeURIComponent(sidoName)}&searchCondition=HOUR`;

    const sidoResp = await fetch(sidoUrl);
    const sidoData = await sidoResp.json();
    const sidoItem = sidoData?.response?.body?.items?.[0];

    if (!sidoItem) return res.status(502).json({ error: '대기질 데이터를 가져올 수 없습니다.' });

    const stationName = sidoItem.stationName;

    // 2단계: 측정소별 API → PM2.5 포함 전체 데이터
    const msrstnUrl =
      `http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty` +
      `?serviceKey=${authKey}&returnType=json&numOfRows=1&pageNo=1` +
      `&stationName=${encodeURIComponent(stationName)}&dataTerm=DAILY&ver=1.4`;

    const msrstnResp = await fetch(msrstnUrl);
    const msrstnData = await msrstnResp.json();
    const item       = msrstnData?.response?.body?.items?.[0] ?? sidoItem;

    const toInt   = (v) => (v && v !== '-' ? parseInt(v)   : null);
    const toFloat = (v) => (v && v !== '-' ? parseFloat(v) : null);
    const toGrade = (v) => AIR_GRADE[parseInt(v)] ?? null;

    res.json({
      station:    stationName,
      pm10:       toInt(item.pm10Value),
      pm10Grade:  toGrade(item.pm10Grade1h ?? item.pm10Grade),
      pm25:       toInt(item.pm25Value),
      pm25Grade:  toGrade(item.pm25Grade1h ?? item.pm25Grade),
      o3:         toFloat(item.o3Value),
      o3Grade:    toGrade(item.o3Grade),
      no2:        toFloat(item.no2Value),
      khaiValue:  toInt(sidoItem.khaiValue),
      khaiGrade:  toGrade(sidoItem.khaiGrade),
    });
  } catch (err) {
    console.error('[/api/air]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/alerts ──────────────────────────────────────────────────────────
app.get('/api/alerts', async (_req, res) => {
  const authKey = process.env.KMA_API_KEY;
  if (!authKey) return res.json([]);

  const pad = (n) => String(n).padStart(2, '0');
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const tmFc =
    `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}` +
    `${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}`;

  try {
    const url =
      `http://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnMsg` +
      `?serviceKey=${authKey}&pageNo=1&numOfRows=10&dataType=JSON` +
      `&fromTmFc=${tmFc}&toTmFc=${tmFc}`;

    const resp = await fetch(url);
    const data = await resp.json();

    const header = data?.response?.header;
    if (!header || header.resultCode !== '00') return res.json([]);

    const raw   = data?.response?.body?.items?.item ?? [];
    const items = Array.isArray(raw) ? raw : [raw];

    const alerts = items.map((item) => ({
      type:   item.title  ?? item.wrnId  ?? '특보',
      region: item.tmEf   ?? '',
      level:  item.wrnLvl === '12' ? 'danger' : 'warning',
    }));

    res.json(alerts);
  } catch (err) {
    console.error('[/api/alerts]', err.message);
    res.json([]);
  }
});

// ── GET /api/map ─────────────────────────────────────────────────────────────
app.get('/api/map', async (_req, res) => {
  if (mapCache && Date.now() - mapCacheTime < MAP_CACHE_TTL) {
    return res.json(mapCache);
  }

  const authKey = process.env.KMA_API_KEY;
  const { base_date, base_time } = getBaseDateTime();
  const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
  const isNight = kstHour >= 21 || kstHour < 6;

  const results = await Promise.allSettled(
    MAP_CITIES.map(async (city) => {
      const { nx, ny } = latLngToGrid(city.lat, city.lng);
      const url = kmaUrl('getUltraSrtNcst', authKey,
        `base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`);
      const resp = await fetch(url);
      const data = await resp.json();
      const header = data?.response?.header;
      if (!header || header.resultCode !== '00') throw new Error('API error');
      const items = data.response.body.items.item;
      const get = (cat) => {
        const it = items.find((i) => i.category === cat);
        return it ? parseFloat(it.obsrValue) : null;
      };
      const pty = Math.round(get('PTY') ?? 0);
      let icon, description, theme;
      if (pty !== 0) {
        ({ icon, description, theme } = PTY_INFO[pty] ?? PTY_INFO[0]);
      } else {
        icon = isNight ? '🌙' : '🌤️';
        description = isNight ? '맑음(야간)' : '맑음';
        theme = 'clear';
      }
      return { name: city.name, lat: city.lat, lng: city.lng, temp: get('T1H'), icon, description, theme };
    })
  );

  const cities = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  mapCache = { cities, updated: new Date().toISOString() };
  mapCacheTime = Date.now();
  res.json(mapCache);
});

app.listen(PORT, () => {
  console.log(`Sky Peek 서버 실행 중: http://localhost:${PORT}`);
});
