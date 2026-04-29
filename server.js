require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 기상청 격자 좌표 매핑
const CITY_GRID = {
  '서울': { nx: 60, ny: 127 },
  '부산': { nx: 98, ny: 76 },
  '인천': { nx: 55, ny: 124 },
  '대구': { nx: 89, ny: 90 },
  '광주': { nx: 58, ny: 74 },
  '대전': { nx: 67, ny: 100 },
  '울산': { nx: 102, ny: 84 },
  '세종': { nx: 66, ny: 103 },
  '수원': { nx: 60, ny: 121 },
  '춘천': { nx: 73, ny: 134 },
  '강릉': { nx: 92, ny: 131 },
  '제주': { nx: 52, ny: 38 },
  '청주': { nx: 69, ny: 106 },
  '전주': { nx: 63, ny: 89 },
  '포항': { nx: 102, ny: 94 },
  '창원': { nx: 90, ny: 77 },
  '고양': { nx: 57, ny: 128 },
  '용인': { nx: 64, ny: 119 },
  '성남': { nx: 63, ny: 124 },
  '안산': { nx: 57, ny: 121 },
};

// PTY(강수형태) → 날씨 정보 매핑
const PTY_INFO = {
  0: { description: '맑음',     icon: '☀️',  theme: 'clear' },
  1: { description: '비',       icon: '🌧️', theme: 'rain'  },
  2: { description: '비/눈',    icon: '🌨️', theme: 'sleet' },
  3: { description: '눈',       icon: '❄️',  theme: 'snow'  },
  5: { description: '이슬비',   icon: '🌦️', theme: 'drizzle' },
  6: { description: '빗방울/눈날림', icon: '🌧️', theme: 'sleet' },
  7: { description: '눈날림',   icon: '🌨️', theme: 'snow'  },
};

// base_date, base_time 계산 (초단기실황은 매 정시 발표)
function getBaseDateTime() {
  const now = new Date();
  // KST 보정 (UTC+9)
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  // 분이 45분 미만이면 한 시간 전 데이터 사용 (API 지연 고려)
  if (kst.getUTCMinutes() < 45) {
    kst.setUTCHours(kst.getUTCHours() - 1);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const base_date =
    `${kst.getUTCFullYear()}` +
    `${pad(kst.getUTCMonth() + 1)}` +
    `${pad(kst.getUTCDate())}`;
  const base_time = `${pad(kst.getUTCHours())}00`;

  return { base_date, base_time };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/weather', async (req, res) => {
  const cityName = req.query.city?.trim();

  if (!cityName) {
    return res.status(400).json({ error: '도시 이름을 입력해주세요.' });
  }

  const grid = CITY_GRID[cityName];
  if (!grid) {
    const available = Object.keys(CITY_GRID).join(', ');
    return res.status(404).json({
      error: `'${cityName}'은(는) 지원하지 않는 도시입니다.`,
      hint: `지원 도시: ${available}`,
    });
  }

  const apiKey = process.env.KMA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버 설정 오류: API 키가 없습니다.' });
  }

  const { base_date, base_time } = getBaseDateTime();
  const url =
    `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` +
    `?serviceKey=${apiKey}` +
    `&pageNo=1&numOfRows=1000&dataType=JSON` +
    `&base_date=${base_date}&base_time=${base_time}` +
    `&nx=${grid.nx}&ny=${grid.ny}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const header = data?.response?.header;
    if (!header || header.resultCode !== '00') {
      const msg = header?.resultMsg || '기상청 API 호출 실패';
      return res.status(502).json({ error: msg });
    }

    const items = data.response.body.items.item;
    const get = (category) => {
      const item = items.find((i) => i.category === category);
      return item ? parseFloat(item.obsrValue) : null;
    };

    const pty = get('PTY') ?? 0;
    const weatherInfo = PTY_INFO[pty] ?? PTY_INFO[0];

    res.json({
      city: cityName,
      base_date,
      base_time,
      temp: get('T1H'),
      humidity: get('REH'),
      wind_speed: get('WSD'),
      wind_dir: get('VEC'),
      precipitation: get('RN1'),
      pty,
      description: weatherInfo.description,
      icon: weatherInfo.icon,
      theme: weatherInfo.theme,
    });
  } catch (err) {
    console.error('API 호출 오류:', err.message);
    res.status(500).json({ error: '날씨 정보를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

app.listen(PORT, () => {
  console.log(`Sky Peek 서버 실행 중: http://localhost:${PORT}`);
});
