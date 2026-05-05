'use strict';

/* ── State ── */
let currentUnit     = 'C';
let currentTempC    = null;
let forecastData    = null;
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
  const sidebar  = document.getElementById('sidebar');
  const main     = document.getElementById('main-content');
  const mapPanel = document.getElementById('map-panel');

  sidebar.classList.remove('panel-active');
  main.classList.remove('panel-active');
  if (mapPanel) mapPanel.classList.remove('panel-active');

  if (panel === 'sidebar') {
    sidebar.classList.add('panel-active');
  } else if (panel === 'main') {
    main.classList.add('panel-active');
  } else if (panel === 'map') {
    if (mapPanel) {
      mapPanel.classList.add('panel-active');
      requestAnimationFrame(() => initMapIfNeeded());
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
function displayAir(data) {
  const gradeClass = { '좋음': 'good', '보통': 'normal', '나쁨': 'bad', '매우나쁨': 'very-bad' };

  const setItem = (valId, gradeId, value, grade) => {
    document.getElementById(valId).textContent = value ?? '--';
    const el = document.getElementById(gradeId);
    el.textContent = grade ?? '';
    el.className   = 'air-grade-badge' + (grade ? ' ' + (gradeClass[grade] ?? '') : '');
  };

  document.getElementById('air-station').textContent = data.station ? `(${data.station})` : '';
  setItem('pm10-val', 'pm10-grade', data.pm10, data.pm10Grade);
  setItem('pm25-val', 'pm25-grade', data.pm25, data.pm25Grade);

  const khai = data.khaiGrade;
  document.getElementById('air-status').textContent =
    khai ? `통합대기환경지수 ${khai}` + (data.khaiValue !== null ? ` (${data.khaiValue})` : '') : '';
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
  ['today', 'week'].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`view-${t}`).style.display = t === tab ? '' : 'none';
  });
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

    const el = document.createElement('div');
    el.className = 'week-item';
    el.innerHTML =
      `<div class="wi-day">${dayLabel}</div>` +
      `<div class="wi-icon">${item.icon}</div>` +
      `<div class="wi-desc">${item.description}</div>` +
      `<div class="wi-pop">${item.pop ? `💧${item.pop}%` : ''}</div>` +
      `<div class="wi-temps">` +
        `<span class="wi-max">${item.max_temp !== null ? toDisplay(item.max_temp) + '°' : '--'}</span>` +
        `<span class="wi-min">${item.min_temp !== null ? toDisplay(item.min_temp) + '°' : '--'}</span>` +
      `</div>`;
    list.appendChild(el);
  });
}

/* ── Search ── */
async function searchCity(city, mobileTarget = 'sidebar') {
  if (!city) return;
  showLoading(true);
  hideError();

  if (window.innerWidth <= 900) switchMobilePanel(mobileTarget);

  try {
    const [wRes, fRes, aRes] = await Promise.all([
      fetch(`/api/weather?city=${encodeURIComponent(city)}`),
      fetch(`/api/forecast?city=${encodeURIComponent(city)}`),
      fetch(`/api/air?city=${encodeURIComponent(city)}`),
    ]);

    const wData = await wRes.json();
    if (!wRes.ok) throw { message: wData.error, hint: wData.hint };

    currentCityName = city;
    currentWData    = wData;

    displayWeather(wData);
    document.getElementById('city-input').value = '';

    if (fRes.ok) {
      const fData = await fRes.json();
      forecastData = fData;
      renderHourly(fData.hourly);
      renderWeek(fData.daily);
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

  document.getElementById('search-btn').addEventListener('click', () => {
    const city = document.getElementById('city-input').value.trim();
    if (city) searchCity(city, 'main');
  });

  document.getElementById('city-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const city = e.target.value.trim();
      if (city) searchCity(city, 'main');
    }
  });

  // 저장된 첫 번째 도시 or 서울 로드
  const first = savedCities[0];
  searchCity(first ? first.query : '서울');
}

document.addEventListener('DOMContentLoaded', init);
