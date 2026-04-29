'use strict';

/* ── State ── */
let currentUnit = 'C';
let currentTempC = null;
let forecastData  = null;

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
  const rad = Math.PI / 180;
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = Math.floor((date - start) / 86400000);
  const B = 360 / 365 * (doy - 81) * rad;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const decl = 23.45 * Math.sin(B) * rad;
  const ha = Math.acos(-Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const noon = 12 - eot / 60 - (lng - 135) / 15;
  const fmt = (h) => {
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
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
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
  const label = pct < 30 ? '😊 건조함' : pct < 60 ? '😌 쾌적함' : pct < 80 ? '😐 보통' : '😰 습함';
  status.textContent = label;
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
  const el = document.getElementById('date-time');
  const tick = () => {
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
  }
  if (forecastData) {
    renderHourly(forecastData.hourly);
    renderWeek(forecastData.daily);
  }
}

/* ── Display Current Weather ── */
function displayWeather(data) {
  applyTheme(data.theme);

  document.getElementById('main-icon').textContent        = data.icon;
  document.getElementById('cond-icon').textContent        = data.icon;
  document.getElementById('main-description').textContent = data.description;
  document.getElementById('city-name-display').textContent = data.city;

  currentTempC = data.temp;
  document.getElementById('main-temp').textContent = toDisplay(data.temp);

  document.getElementById('rain-info').textContent =
    data.precipitation !== null ? `강수량: ${data.precipitation}mm` : '강수량: -';

  document.getElementById('wind-speed').textContent =
    data.wind_speed !== null ? data.wind_speed : '--';
  document.getElementById('wind-dir-label').textContent =
    data.wind_dir !== null ? `${windDirLabel(data.wind_dir)} 방향` : '--';

  document.getElementById('humidity-val').textContent = data.humidity ?? '--';
  updateHumBar(data.humidity);

  drawUVGauge(null);

  if (data.lat && data.lng) {
    const { sunrise, sunset } = calcSunTimes(data.lat, data.lng, new Date());
    document.getElementById('sunrise-time').textContent = sunrise;
    document.getElementById('sunset-time').textContent  = sunset;
  }
}

/* ── Render Hourly ── */
function renderHourly(hourly) {
  const row = document.getElementById('forecast-row');
  row.innerHTML = '';

  const now       = new Date();
  const nowDs     = dateStr(now);
  const nowHour   = now.getHours();

  const items = hourly.filter((h) => {
    if (h.date > nowDs) return true;
    return h.date === nowDs && parseInt(h.time.substring(0, 2), 10) >= nowHour;
  }).slice(0, 8);

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
  const list = document.getElementById('week-list');
  list.innerHTML = '';

  const now    = new Date();
  const nowDs  = dateStr(now);
  const DAYS   = ['일','월','화','수','목','금','토'];

  daily.slice(0, 7).forEach((item) => {
    let dayLabel;
    if (item.date === nowDs) {
      dayLabel = '오늘';
    } else {
      const y = parseInt(item.date.slice(0, 4), 10);
      const m = parseInt(item.date.slice(4, 6), 10) - 1;
      const d = parseInt(item.date.slice(6, 8), 10);
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
async function searchCity(city) {
  if (!city) return;
  showLoading(true);
  hideError();

  try {
    const [wRes, fRes] = await Promise.all([
      fetch(`/api/weather?city=${encodeURIComponent(city)}`),
      fetch(`/api/forecast?city=${encodeURIComponent(city)}`),
    ]);

    const wData = await wRes.json();
    if (!wRes.ok) throw { message: wData.error, hint: wData.hint };

    displayWeather(wData);

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
  } catch (err) {
    showError(err.message || '오류가 발생했습니다.', err.hint);
  } finally {
    showLoading(false);
  }
}

/* ── Init ── */
function init() {
  startClock();
  drawUVGauge(null);

  document.getElementById('search-btn').addEventListener('click', () => {
    const city = document.getElementById('city-input').value.trim();
    if (city) searchCity(city);
  });

  document.getElementById('city-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const city = e.target.value.trim();
      if (city) searchCity(city);
    }
  });

  searchCity('서울');
}

document.addEventListener('DOMContentLoaded', init);
