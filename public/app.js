'use strict';

/* ── State ── */
let currentUnit     = 'C';
let currentTempC    = null;
let forecastData    = null;
let midForecastData = null;
let currentCityName = '';
let currentWData    = null;
let currentAData    = null;

/* ── Map State ── */
let weatherMap    = null;
let mapMarkers    = [];
let mapLastFetch  = 0;
const MAP_CLIENT_TTL = 5 * 60 * 1000;

/* ── 저장 도시 (localStorage) ── */
const STORAGE_KEY = 'skypeek_cities';
let savedCities = [];

function loadSaved() {
  try { savedCities = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; }
  catch { savedCities = []; }
}

function persistSaved() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCities));
}

function addCurrentCity() {
  if (!currentWData || savedCities.length >= 5) return;
  if (savedCities.some(c => c.query === currentCityName)) return;
  savedCities.push({
    query:     currentCityName,
    name:      currentWData.city,
    temp:      currentWData.temp,
    icon:      currentWData.icon,
    theme:     currentWData.theme,
    pm25:      currentAData?.pm25 ?? null,
    pm25Grade: currentAData?.pm25Grade ?? null,
  });
  persistSaved();
  renderSavedCities();
}

function removeSavedCity(index) {
  savedCities.splice(index, 1);
  persistSaved();
  renderSavedCities();
}

function renderSavedCities() {
  const list     = document.getElementById('saved-list');
  const countEl  = document.getElementById('saved-count');
  const saveBtn  = document.getElementById('save-city-btn');

  countEl.textContent = savedCities.length;

  const alreadySaved = currentCityName && savedCities.some(c => c.query === currentCityName);
  const maxReached   = savedCities.length >= 5;
  const saveable     = !!currentCityName && !alreadySaved && !maxReached;
  const saveLabel    = alreadySaved ? '저장됨' : maxReached ? '최대 5개' : '+ 저장';

  saveBtn.disabled    = !saveable;
  saveBtn.textContent = saveLabel;

  const mcbSaveBtn = document.getElementById('mcb-save-btn');
  if (mcbSaveBtn) {
    mcbSaveBtn.disabled    = !saveable;
    mcbSaveBtn.textContent = saveLabel;
  }

  if (!savedCities.length) {
    list.innerHTML = '<div class="saved-empty">검색 후 지역을 저장하세요</div>';
    return;
  }

  list.innerHTML = '';
  savedCities.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'saved-city-card' + (c.query === currentCityName ? ' active' : '');

    const pm25Label = c.pm25Grade ? ` · PM2.5 ${c.pm25Grade}` : '';
    card.innerHTML =
      `<div class="sc-left">` +
        `<span class="sc-icon">${c.icon}</span>` +
        `<div class="sc-info">` +
          `<div class="sc-name">${c.name}</div>` +
          `<div class="sc-meta">${toDisplay(c.temp)}°${currentUnit}${pm25Label}</div>` +
        `</div>` +
      `</div>` +
      `<button class="sc-del" title="삭제" data-idx="${i}">×</button>`;

    card.querySelector('.sc-left').addEventListener('click', () => searchCity(c.query, 'main'));
    card.querySelector('.sc-del').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSavedCity(i);
    });

    list.appendChild(card);
  });
}

/* ── 모바일 패널 전환 ── */
function switchMobilePanel(panel) {
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main-content');

  sidebar.classList.remove('panel-active');
  main.classList.remove('panel-active');

  if (panel === 'sidebar') {
    sidebar.classList.add('panel-active');
  } else {
    main.classList.add('panel-active');
    if (panel === 'map') {
      switchTab('map');
    } else if (document.getElementById('tab-map').classList.contains('active')) {
      switchTab('today');
    }
  }

  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
}

/* ── 지도 초기화 및 마커 ── */
function initMapIfNeeded() {
  const container = document.getElementById('weather-map');
  if (!container) return;

  if (!weatherMap) {
    weatherMap = L.map('weather-map', {
      zoomControl: true,
      attributionControl: false,
    }).setView([36.5, 127.8], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(weatherMap);
  }

  weatherMap.invalidateSize();
  loadMapWeather();
}

async function loadMapWeather() {
  if (mapMarkers.length > 0 && Date.now() - mapLastFetch < MAP_CLIENT_TTL) return;
  try {
    const res = await fetch('/api/map');
    if (!res.ok) return;
    const data = await res.json();
    placeMapMarkers(data.cities);
    mapLastFetch = Date.now();
  } catch { /* 지도 오류 무시 */ }
}

function placeMapMarkers(cities) {
  mapMarkers.forEach((m) => weatherMap.removeLayer(m));
  mapMarkers = [];

  cities.forEach((city) => {
    const tempText = city.temp !== null ? `${Math.round(city.temp)}` : '--';
    const divIcon = L.divIcon({
      className: 'weather-marker',
      html:
        `<div class="wm-wrap">` +
          `<div class="wm-bubble">` +
            `<div class="wm-name">${city.name}</div>` +
            `<div class="wm-icon">${city.icon}</div>` +
            `<div class="wm-temp">${tempText}</div>` +
          `</div>` +
          `<div class="wm-tail"></div>` +
        `</div>`,
      iconSize: [64, 78],
      iconAnchor: [32, 78],
      popupAnchor: [0, -80],
    });

    const marker = L.marker([city.lat, city.lng], { icon: divIcon }).addTo(weatherMap);
    marker.bindPopup(
      `<div class="map-popup">` +
        `<div class="mp-city">${city.icon} ${city.name}</div>` +
        `<div class="mp-row">🌡 ${city.temp !== null ? Math.round(city.temp) + '°C' : '--'}</div>` +
        `<div class="mp-row">${city.description}</div>` +
      `</div>`
    );
    mapMarkers.push(marker);
  });
}

/* ── Helpers ── */
const pad2 = (n) => String(n).padStart(2, '0');

function toDisplay(c) {
  if (c === null || c === undefined) return '--';
  return currentUnit === 'F' ? Math.round(c * 9 / 5 + 32) : Math.round(c);
}

function dateStr(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function timeLabel(fcstDate, fcstTime, nowDateStr) {
  const h   = parseInt(fcstTime.substring(0, 2), 10);
  const h12 = h % 12 || 12;
  const ap  = h >= 12 ? 'PM' : 'AM';
  return fcstDate === nowDateStr ? `${h12}${ap}` : `내일 ${h12}${ap}`;
}

function windDirLabel(deg) {
  if (deg === null || deg === undefined) return '--';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/* ── Sunrise / Sunset ── */
function calcSunTimes(lat, lng, date) {
  const rad   = Math.PI / 180;
  const start = new Date(date.getFullYear(), 0, 0);
  const doy   = Math.floor((date - start) / 86400000);
  const B     = 360 / 365 * (doy - 81) * rad;
  const eot   = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const decl  = 23.45 * Math.sin(B) * rad;
  const ha    = Math.acos(-Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const noon  = 12 - eot / 60 - (lng - 135) / 15;
  const fmt   = (h) => {
    const hr = Math.floor(h);
    const mn = Math.round((h - hr) * 60);
    return `${pad2(hr)}:${pad2(mn < 60 ? mn : 59)}`;
  };
  return { sunrise: fmt(noon - ha / 15), sunset: fmt(noon + ha / 15) };
}

/* ── UV Gauge ── */
function drawUVGauge(value) {
  const canvas = document.getElementById('uv-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h - 6, r = Math.min(cx - 6, cy - 6);

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.stroke();

  const valEl = document.getElementById('uv-value');
  if (value !== null && value !== undefined) {
    const ratio = Math.min(value / 11, 1);
    const grad  = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0,    '#289500');
    grad.addColorStop(0.42, '#f7e400');
    grad.addColorStop(0.75, '#f85900');
    grad.addColorStop(1,    '#6b49c8');
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI + ratio * Math.PI);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();
    valEl.textContent = value;
  } else {
    valEl.textContent = 'N/A';
  }
}

/* ── Humidity Bar ── */
function updateHumBar(pct) {
  const bar    = document.getElementById('hum-bar');
  const dot    = document.getElementById('hum-dot');
  const status = document.getElementById('hum-status');
  if (pct === null || pct === undefined) {
    bar.style.width = '0%';
    dot.style.left  = '0%';
    status.textContent = '';
    return;
  }
  bar.style.width = `${pct}%`;
  dot.style.left  = `calc(${pct}% - 5px)`;
  status.textContent = pct < 30 ? '😊 건조함' : pct < 60 ? '😌 쾌적함' : pct < 80 ? '😐 보통' : '😰 습함';
}

/* ── Air Quality ── */
function getAirRecommendation(grade) {
  const recs = {
    '좋음':    '😊 야외 활동에 적합합니다',
    '보통':    '😐 민감군은 장시간 야외 활동 주의',
    '나쁨':    '😷 마스크 착용 권고, 야외 활동 자제',
    '매우나쁨': '🚫 외출 자제, 마스크 필수',
  };
  return recs[grade] ?? '';
}

function displayAir(data) {
  const gradeClass = { '좋음': 'good', '보통': 'normal', '나쁨': 'bad', '매우나쁨': 'very-bad' };

  const setItem = (valId, gradeId, value, grade) => {
    document.getElementById(valId).textContent = value ?? '--';
    if (gradeId) {
      const el = document.getElementById(gradeId);
      el.textContent = grade ?? '';
      el.className   = 'air-grade-badge' + (grade ? ' ' + (gradeClass[grade] ?? '') : '');
    }
  };

  document.getElementById('air-station').textContent = data.station ? `(${data.station})` : '';
  setItem('pm10-val', 'pm10-grade', data.pm10, data.pm10Grade);
  setItem('pm25-val', 'pm25-grade', data.pm25, data.pm25Grade);
  setItem('o3-val',  'o3-grade',  data.o3  !== null ? data.o3?.toFixed(3)  : null, data.o3Grade);
  setItem('no2-val', null,        data.no2 !== null ? data.no2?.toFixed(3) : null, null);

  const khai = data.khaiGrade;
  document.getElementById('air-status').textContent =
    khai ? `통합대기환경지수 ${khai}` + (data.khaiValue !== null ? ` (${data.khaiValue})` : '') : '';

  const gradeOrder = { '매우나쁨': 4, '나쁨': 3, '보통': 2, '좋음': 1 };
  const worstGrade = [data.pm25Grade, data.pm10Grade, data.o3Grade, khai]
    .reduce((worst, g) => (gradeOrder[g] ?? 0) > (gradeOrder[worst] ?? 0) ? g : worst, null);
  document.getElementById('air-recommendation').textContent = getAirRecommendation(worstGrade);
}

/* ── Hourly Temperature Chart ── */
function renderTempChart(hourly) {
  const canvas = document.getElementById('temp-chart');
  if (!canvas || !hourly || !hourly.length) return;

  const ctx  = canvas.getContext('2d');
  const now  = new Date();
  const nowDs   = dateStr(now);
  const nowHour = now.getHours();

  const items = hourly.filter((h) => {
    if (h.date > nowDs) return true;
    return h.date === nowDs && parseInt(h.time.substring(0, 2), 10) >= nowHour;
  }).slice(0, 24);
  if (!items.length) return;

  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.parentElement.clientWidth || 600;
  const H    = 130;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  const PAD  = { top: 20, right: 16, bottom: 28, left: 10 };
  const cW   = W - PAD.left - PAD.right;
  const cH   = H - PAD.top  - PAD.bottom;

  const temps = items.map((i) => toDisplay(i.temp ?? 0));
  const pops  = items.map((i) => i.pop ?? 0);
  const minT  = Math.min(...temps) - 2;
  const maxT  = Math.max(...temps) + 2;
  const range = maxT - minT || 1;

  const n    = items.length;
  const xAt  = (i) => PAD.left + (i / (n - 1 || 1)) * cW;
  const yAt  = (t) => PAD.top  + cH - ((t - minT) / range) * cH;

  ctx.clearRect(0, 0, W, H);

  // POP area
  ctx.beginPath();
  items.forEach((_, i) => {
    const x = xAt(i);
    const y = PAD.top + cH - (pops[i] / 100) * cH * 0.42;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xAt(n - 1), PAD.top + cH);
  ctx.lineTo(xAt(0),     PAD.top + cH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(115,145,212,0.13)';
  ctx.fill();

  // Temp line
  const grad = ctx.createLinearGradient(PAD.left, 0, W - PAD.right, 0);
  grad.addColorStop(0, '#7391d4');
  grad.addColorStop(1, '#a85ce8');
  ctx.beginPath();
  items.forEach((_, i) => {
    const x = xAt(i), y = yAt(temps[i]);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Temp labels
  ctx.font      = '11px Segoe UI, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e7e7eb';
  const step = Math.max(1, Math.floor(n / 8));
  items.forEach((_, i) => {
    if (i % step === 0 || i === n - 1) {
      ctx.fillText(temps[i] + '°', xAt(i), yAt(temps[i]) - 6);
    }
  });

  // X-axis time labels
  ctx.fillStyle = '#a09fb1';
  ctx.font      = '10px Segoe UI, system-ui, sans-serif';
  items.forEach((item, i) => {
    if (i % step === 0 || i === n - 1) {
      const h     = parseInt(item.time.substring(0, 2), 10);
      const label = item.date > nowDs ? `내일 ${h}시` : `${h}시`;
      ctx.fillText(label, xAt(i), H - 7);
    }
  });

  // Now marker
  ctx.beginPath();
  ctx.moveTo(xAt(0), PAD.top);
  ctx.lineTo(xAt(0), PAD.top + cH);
  ctx.strokeStyle = 'rgba(255,220,80,0.5)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ── Weather Alerts ── */
async function loadAlerts(city) {
  const banner = document.getElementById('alert-banner');
  if (!banner) return;
  try {
    const res = await fetch(`/api/alerts?city=${encodeURIComponent(city)}`);
    if (!res.ok) { banner.style.display = 'none'; return; }
    const alerts = await res.json();
    if (!alerts.length) { banner.style.display = 'none'; return; }
    banner.innerHTML = alerts.map((a) =>
      `<div class="alert-item alert-${a.level}">⚠️ <strong>${a.type}</strong>${a.region ? ' · ' + a.region : ''}</div>`
    ).join('');
    banner.style.display = '';
  } catch {
    banner.style.display = 'none';
  }
}

/* ── Theme ── */
function applyTheme(theme) {
  ['clear','rain','snow','sleet','drizzle','cloudy','overcast'].forEach(
    (t) => document.body.classList.remove(`theme-${t}`)
  );
  if (theme) document.body.classList.add(`theme-${theme}`);
}

/* ── Clock ── */
function startClock() {
  const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const el     = document.getElementById('date-time');
  const tick   = () => {
    const now = new Date();
    el.textContent = `${DAY_KO[now.getDay()]}요일, ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  };
  tick();
  setInterval(tick, 30000);
}

/* ── Loading / Error ── */
function showLoading(show) {
  document.getElementById('loading').style.display = show ? '' : 'none';
}
function showError(msg, hint) {
  document.getElementById('error-msg').textContent  = msg ?? '';
  document.getElementById('error-hint').textContent = hint ?? '';
  document.getElementById('error-card').style.display = '';
}
function hideError() {
  document.getElementById('error-card').style.display = 'none';
}

/* ── Tab / Unit ── */
function switchTab(tab) {
  ['today', 'highlights', 'week', 'map'].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`view-${t}`).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'map') {
    requestAnimationFrame(() => {
      initMapIfNeeded();
      if (weatherMap) weatherMap.invalidateSize();
    });
  }
}

function setUnit(unit) {
  currentUnit = unit;
  document.getElementById('btn-c').classList.toggle('active', unit === 'C');
  document.getElementById('btn-f').classList.toggle('active', unit === 'F');
  document.getElementById('temp-unit-display').textContent = `°${unit}`;
  if (currentTempC !== null) {
    document.getElementById('main-temp').textContent = toDisplay(currentTempC);
    document.getElementById('mcb-temp').textContent  = toDisplay(currentTempC) + '°';
  }
  if (forecastData) {
    renderHourly(forecastData.hourly);
    renderWeek(forecastData.daily);
    renderTempChart(forecastData.hourly);
    renderTodaySummary();
    renderWeekSummary();
  }
  renderSavedCities(); // 저장 카드 온도도 갱신
}

/* ── Display Current Weather ── */
function displayWeather(data) {
  applyTheme(data.theme);

  document.getElementById('main-icon').textContent         = data.icon;
  document.getElementById('cond-icon').textContent         = data.icon;
  document.getElementById('main-description').textContent  = data.description;

  currentTempC = data.temp;
  document.getElementById('main-temp').textContent = toDisplay(data.temp);

  // 모바일 예보 탭 상단 도시 바 업데이트
  document.getElementById('mcb-icon').textContent   = data.icon;
  document.getElementById('mcb-name').textContent   = data.city;
  document.getElementById('mcb-detail').textContent = data.description;
  document.getElementById('mcb-temp').textContent   = toDisplay(data.temp) + '°';

  document.getElementById('rain-info').textContent =
    data.precipitation !== null ? `강수량: ${data.precipitation}mm` : '강수량: -';

  document.getElementById('wind-speed').textContent =
    data.wind_speed !== null ? data.wind_speed : '--';
  document.getElementById('wind-dir-label').textContent =
    data.wind_dir !== null ? `${windDirLabel(data.wind_dir)} 방향` : '--';

  document.getElementById('humidity-val').textContent = data.humidity ?? '--';
  updateHumBar(data.humidity);

  drawUVGauge(data.uv_index ?? null);

  if (data.lat && data.lng) {
    const { sunrise, sunset } = calcSunTimes(data.lat, data.lng, new Date());
    document.getElementById('sunrise-time').textContent = sunrise;
    document.getElementById('sunset-time').textContent  = sunset;
  }
}

/* ── Render Hourly ── */
function renderHourly(hourly) {
  const row     = document.getElementById('forecast-row');
  const now     = new Date();
  const nowDs   = dateStr(now);
  const nowHour = now.getHours();

  const items = hourly.filter((h) => {
    if (h.date > nowDs) return true;
    return h.date === nowDs && parseInt(h.time.substring(0, 2), 10) >= nowHour;
  }).slice(0, 8);

  row.innerHTML = '';
  if (!items.length) {
    row.insertAdjacentHTML('beforeend', '<div style="color:#a09fb1;padding:14px">예보 데이터가 없습니다.</div>');
    return;
  }

  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'forecast-card' + (idx === 0 ? ' active-card' : '');
    card.innerHTML =
      `<div class="fc-time">${timeLabel(item.date, item.time, nowDs)}</div>` +
      `<div class="fc-icon">${item.icon}</div>` +
      `<div class="fc-temp">${toDisplay(item.temp)}°</div>` +
      (item.pop !== null ? `<div class="fc-pop">💧 ${item.pop}%</div>` : '');
    row.appendChild(card);
  });
}

/* ── Render Week ── */
function renderWeek(daily) {
  const list  = document.getElementById('week-list');
  const now   = new Date();
  const nowDs = dateStr(now);
  const DAYS  = ['일','월','화','수','목','금','토'];

  list.innerHTML = '';
  daily.slice(0, 7).forEach((item) => {
    let dayLabel;
    if (item.date === nowDs) {
      dayLabel = '오늘';
    } else {
      const y  = parseInt(item.date.slice(0, 4), 10);
      const m  = parseInt(item.date.slice(4, 6), 10) - 1;
      const d  = parseInt(item.date.slice(6, 8), 10);
      const dt = new Date(y, m, d);
      dayLabel = `${DAYS[dt.getDay()]}요일 (${m + 1}/${d})`;
    }

    const midDay = midForecastData?.days?.find(md => md.date === item.date);
    let descText = item.description;
    if (midDay?.amText) {
      descText = midDay.pmText && midDay.pmText !== midDay.amText
        ? `${midDay.amText} / ${midDay.pmText}`
        : midDay.amText;
    }

    const el = document.createElement('div');
    el.className = 'week-item';
    el.innerHTML =
      `<div class="wi-day">${dayLabel}</div>` +
      `<div class="wi-icon">${item.icon}</div>` +
      `<div class="wi-desc">${descText}</div>` +
      `<div class="wi-pop">${item.pop !== null && item.pop > 0 ? `💧${item.pop}%` : (midDay?.pop ? `💧${midDay.pop}%` : '')}</div>` +
      `<div class="wi-temps">` +
        `<span class="wi-max">${item.max_temp !== null ? toDisplay(item.max_temp) + '°' : '--'}</span>` +
        `<span class="wi-min">${item.min_temp !== null ? toDisplay(item.min_temp) + '°' : '--'}</span>` +
      `</div>`;
    list.appendChild(el);
  });
}

/* ── Weather Summary Text ── */
function renderTodaySummary() {
  const el = document.getElementById('today-summary');
  if (!el || !currentWData) { if (el) el.textContent = ''; return; }

  const city  = currentWData.city;
  const nowDs = dateStr(new Date());
  const parts = [];

  // 오전/오후/저녁별 대표 날씨 — 시간별 예보에서 추출
  if (forecastData?.hourly?.length) {
    const todaySlots = forecastData.hourly.filter(h => h.date === nowDs);
    const periods = [
      { label: '오전', start: 6,  end: 12 },
      { label: '오후', start: 12, end: 18 },
      { label: '저녁', start: 18, end: 24 },
    ];

    const descs = periods.map(({ label, start, end }) => {
      const slots = todaySlots.filter(h => {
        const hr = parseInt(h.time.substring(0, 2), 10);
        return hr >= start && hr < end;
      });
      if (!slots.length) return null;
      const slot = slots.find(s => s.pty > 0) ?? slots[Math.floor(slots.length / 2)];
      return { label, desc: slot.description };
    }).filter(Boolean);

    // 연속 동일 날씨 압축 ("오전·오후 맑음" 형태)
    const merged = descs.reduce((acc, cur) => {
      const last = acc[acc.length - 1];
      if (last && last.desc === cur.desc) last.label += `·${cur.label}`;
      else acc.push({ ...cur });
      return acc;
    }, []);

    if (merged.length) {
      const timeText = merged.map(d => `${d.label} ${d.desc}`).join(', ');
      parts.push(`오늘 ${city}은(는) ${timeText}입니다.`);
    } else {
      parts.push(`오늘 ${city}은(는) ${currentWData.description}입니다.`);
    }
  } else {
    parts.push(`오늘 ${city}은(는) ${currentWData.description}입니다.`);
  }

  // 최고/최저 기온 + 강수확률
  if (forecastData?.daily?.length) {
    const today = forecastData.daily[0];
    const maxT  = today.max_temp !== null ? toDisplay(today.max_temp) + '°' : null;
    const minT  = today.min_temp !== null ? toDisplay(today.min_temp) + '°' : null;
    if (maxT && minT) parts.push(`최고 ${maxT} / 최저 ${minT}`);
    if (today.pop > 0) parts.push(`강수확률 최대 ${today.pop}%`);
  }

  const tip =
    currentWData.pty > 0              ? '우산을 챙기세요.' :
    (currentWData.uv_index ?? 0) >= 8  ? '자외선이 강합니다. 선크림을 바르세요.' :
    (currentWData.humidity ?? 0) >= 80 ? '습도가 높아 불쾌지수가 높습니다.' :
    currentWData.temp >= 33            ? '폭염 주의가 필요합니다.' :
    currentWData.temp <= 0             ? '영하의 날씨입니다. 따뜻하게 입으세요.' : '';

  el.textContent = parts.join(' · ') + (tip ? '  ' + tip : '');
}

function renderWeekSummary() {
  const el = document.getElementById('week-summary');
  if (!el || !forecastData?.daily?.length) { if (el) el.textContent = ''; return; }

  const daily = forecastData.daily.slice(0, 7);
  const DAYS  = ['일', '월', '화', '수', '목', '금', '토'];
  const nowDs = dateStr(new Date());

  const getDayLabel = (d) => {
    if (d.date === nowDs) return '오늘';
    const y   = parseInt(d.date.slice(0, 4), 10);
    const m   = parseInt(d.date.slice(4, 6), 10) - 1;
    const day = parseInt(d.date.slice(6, 8), 10);
    return DAYS[new Date(y, m, day).getDay()] + '요일';
  };

  const rainyDays = daily.filter(d => d.pop > 40);
  let summary = '';

  if (rainyDays.length === 0) {
    summary = `이번 주 ${currentWData?.city ?? ''}은(는) 대체로 맑겠습니다.`;
  } else if (rainyDays.length >= Math.ceil(daily.length * 0.6)) {
    summary = '이번 주는 흐리고 비 오는 날이 많겠습니다.';
  } else {
    // 연속 구간인지 확인
    const indices  = rainyDays.map(d => daily.indexOf(d));
    const isConsec = indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1);
    const first    = getDayLabel(rainyDays[0]);
    const last     = getDayLabel(rainyDays[rainyDays.length - 1]);

    if (rainyDays.length === 1) {
      summary = `${first}(강수확률 ${rainyDays[0].pop}%)에 비가 예상됩니다. 우산을 준비하세요.`;
    } else if (isConsec) {
      summary = `${first}부터 ${last}까지 비가 예상됩니다. 우산을 준비하세요.`;
    } else {
      summary = `${rainyDays.slice(0, 2).map(getDayLabel).join(', ')} 등에 비가 예상됩니다. 우산을 준비하세요.`;
    }
  }

  // 기온 추세 + 주간 최고/최저
  const maxTemps = daily.map(d => d.max_temp).filter(t => t !== null);
  const minTemps = daily.map(d => d.min_temp).filter(t => t !== null);
  if (maxTemps.length >= 2) {
    const diff = toDisplay(maxTemps[maxTemps.length - 1]) - toDisplay(maxTemps[0]);
    if (diff >= 5)       summary += ' 기온은 주말로 갈수록 오르겠습니다.';
    else if (diff <= -5) summary += ' 기온은 주말로 갈수록 낮아지겠습니다.';

    const weekMax = Math.max(...maxTemps.map(t => toDisplay(t)));
    const weekMin = minTemps.length ? Math.min(...minTemps.map(t => toDisplay(t))) : null;
    summary += weekMin !== null
      ? ` 이번 주 최고 ${weekMax}° / 최저 ${weekMin}°`
      : ` 이번 주 최고 ${weekMax}°`;
  }

  // 중기예보 데이터로 단기 범위 이후 강수 여부 보완
  if (midForecastData?.days?.length) {
    const shortDates = new Set(daily.map(d => d.date));
    const midExtra = midForecastData.days.filter(d => !shortDates.has(d.date));
    if (midExtra.length > 0) {
      const midRainy = midExtra.filter(d =>
        (d.pop ?? 0) > 40 || [d.amText, d.pmText].some(t => t?.includes('비'))
      );
      if (midRainy.length > 0 && !summary.includes('비')) {
        summary += ' 이후 비 오는 날도 예상됩니다.';
      }
    }
  }

  el.textContent = summary;
}

/* ── Candidate List ── */
function showCandidates(candidates) {
  const list = document.getElementById('candidate-list');
  list.innerHTML =
    `<div class="candidate-header">지역을 선택해주세요 (${candidates.length}개)</div>` +
    candidates.map((c) =>
      `<div class="candidate-item" data-key="${c.cacheKey}">` +
        `<div class="candidate-name">${c.name}</div>` +
        `<div class="candidate-region">${c.region}</div>` +
      `</div>`
    ).join('');
  list.style.display = '';
}

function hideCandidates() {
  const list = document.getElementById('candidate-list');
  list.style.display = 'none';
  list.innerHTML = '';
}

async function handleSearch(query, mobileTarget = 'main') {
  if (!query) return;
  hideCandidates();

  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const candidates = await res.json();

    if (!res.ok) throw new Error(candidates.error || '위치 검색 실패');
    if (!candidates.length) {
      showError(`'${query}' 위치를 찾을 수 없습니다.`, '다른 이름으로 검색해보세요.');
      return;
    }

    if (candidates.length === 1) {
      searchCity(candidates[0].cacheKey, mobileTarget);
    } else {
      showCandidates(candidates);
    }
  } catch (err) {
    showError(err.message || '오류가 발생했습니다.');
  }
}

/* ── Search ── */
async function searchCity(city, mobileTarget = 'sidebar') {
  if (!city) return;
  showLoading(true);
  hideError();
  midForecastData = null;

  if (window.innerWidth <= 900) switchMobilePanel(mobileTarget);

  try {
    const [wRes, fRes, aRes, mRes] = await Promise.all([
      fetch(`/api/weather?city=${encodeURIComponent(city)}`),
      fetch(`/api/forecast?city=${encodeURIComponent(city)}`),
      fetch(`/api/air?city=${encodeURIComponent(city)}`),
      fetch(`/api/midforecast?city=${encodeURIComponent(city)}`),
    ]);

    const wData = await wRes.json();
    if (!wRes.ok) throw { message: wData.error, hint: wData.hint };

    currentCityName = city;
    currentWData    = wData;

    displayWeather(wData);
    document.getElementById('city-input').value = '';

    if (mRes.ok) {
      const mData = await mRes.json();
      midForecastData = mData.days?.length ? mData : null;
    }

    if (fRes.ok) {
      const fData = await fRes.json();
      forecastData = fData;
      renderHourly(fData.hourly);
      renderWeek(fData.daily);
      renderTempChart(fData.hourly);
      renderTodaySummary();
      renderWeekSummary();
    } else {
      forecastData = null;
      document.getElementById('forecast-row').innerHTML =
        '<div style="color:#a09fb1;padding:14px">예보 데이터를 불러올 수 없습니다.</div>';
      document.getElementById('week-list').innerHTML = '';
    }

    if (aRes.ok) {
      const aData = await aRes.json();
      currentAData = aData;
      displayAir(aData);
    } else {
      currentAData = null;
    }

    renderSavedCities();
    loadAlerts(city);
  } catch (err) {
    showError(err.message || '오류가 발생했습니다.', err.hint);
  } finally {
    showLoading(false);
  }
}

/* ── Init ── */
function init() {
  loadSaved();
  startClock();
  drawUVGauge(null);

  // 초기 모바일 패널 설정
  if (window.innerWidth <= 900) {
    document.getElementById('sidebar').classList.add('panel-active');
  }

  document.getElementById('candidate-list').addEventListener('click', (e) => {
    const item = e.target.closest('.candidate-item');
    if (!item) return;
    hideCandidates();
    searchCity(item.dataset.key, 'main');
  });

  document.getElementById('search-btn').addEventListener('click', () => {
    const city = document.getElementById('city-input').value.trim();
    if (city) handleSearch(city, 'main');
  });

  document.getElementById('city-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const city = e.target.value.trim();
      if (city) handleSearch(city, 'main');
    }
    if (e.key === 'Escape') hideCandidates();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) hideCandidates();
  });

  // 저장된 첫 번째 도시 or 서울 로드
  const first = savedCities[0];
  searchCity(first ? first.query : '서울');
}

document.addEventListener('DOMContentLoaded', init);
