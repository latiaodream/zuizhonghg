#!/usr/bin/env node
/*
  iSports 今日赛事抓取小工具（皇冠专用）

  功能：
  - 从 iSports /schedule/basic 拉取今日赛程（默认足球）
  - 可选：仅输出拥有皇冠(companyId=3)赔率的比赛
  - 输出简洁 JSON：league, home, away, matchId, matchTime, status, period, crownOddsAvailable

  使用：
  - 设置环境变量 ISP0RTS_API_KEY（或使用 --apiKey 参数）
  - node scripts/isports_today.js [--date=YYYY-MM-DD] [--sport=ft|bk] [--onlyCrownOdds] [--lang=en|zh-cn|zh-tw]

  示例：
  - node scripts/isports_today.js --onlyCrownOdds
  - node scripts/isports_today.js --date=2025-11-05 --sport=ft
  - node scripts/isports_today.js --lang=en

  说明：
  - date 默认取当前 UTC 日期（与项目现有 fetcher 一致）
  - sport: ft=football（默认），bk=basketball
  - 仅依赖 Node18+ 的全局 fetch，无需额外安装依赖
*/

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const p = args.find(a => a.startsWith(`--${name}=`));
  if (p) return p.split('=')[1];
  return def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const API_KEY = process.env.ISPORTS_API_KEY || getArg('apiKey', '');
const sport = getArg('sport', 'ft'); // ft | bk
const date = getArg('date', new Date().toISOString().split('T')[0]);
const onlyCrownOdds = hasFlag('onlyCrownOdds');
const lang = getArg('lang', ''); // iSports 常见: en | zh-cn | zh-tw 等

if (!API_KEY) {
  console.error('❌ 缺少 ISPORTS_API_KEY，请通过环境变量或 --apiKey 传入');
  process.exit(1);
}

const BASE_URL = sport === 'bk'
  ? 'http://api.isportsapi.com/sport/basketball'
  : 'http://api.isportsapi.com/sport/football';

const qs = (obj) => new URLSearchParams(obj).toString();

async function get(endpoint, params) {
  const url = `${BASE_URL}${endpoint}?${qs(params)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

const normalizeStatus = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

const derivePeriod = (status, match) => {
  if (status !== 1) {
    if (status === 0) return '未开赛';
    if (status === -1 || status === 3) return '已结束';
    return '';
  }
  const minute = match?.extraExplain?.minute ?? match?.minute ?? 0;
  if (minute <= 45) return '1H';
  if (minute > 45 && minute <= 90) return '2H';
  if (minute > 90) return 'ET';
  return '滚球';
};

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchTodaySchedule() {
  const params = { api_key: API_KEY, date };
  if (lang) params.lang = lang;
  const body = await get('/schedule/basic', params);
  if (body.code !== 0) {
    throw new Error(`iSports /schedule/basic error: ${JSON.stringify(body)}`);
  }
  return body.data || [];
}

async function fetchCrownOddsByMatchIds(matchIds) {
  if (!matchIds.length) return {};
  const map = {};
  const batches = chunk(matchIds, 50);
  for (const batch of batches) {
    const body = await get('/odds/all', { api_key: API_KEY, companyId: '3', matchId: batch.join(',') });
    if (body.code !== 0) continue;
    const d = body.data || {};
    ['handicap','europeOdds','overUnder','handicapHalf','overUnderHalf'].forEach((key) => {
      (d[key] || []).forEach((row) => {
        const parts = String(row).split(',');
        const matchId = parts[0];
        if (!map[matchId]) map[matchId] = { handicap:0, europeOdds:0, overUnder:0, handicapHalf:0, overUnderHalf:0 };
        map[matchId][key] = (map[matchId][key] || 0) + 1;
      });
    });
  }
  return map;
}

(async function main() {
  try {
    const schedule = await fetchTodaySchedule();

    // 仅保留今日（date）且非已结束的比赛
    const todayMatches = schedule.filter((m) => {
      const status = normalizeStatus(m.status);
      return status !== -1 && status !== 3; // 未开赛或进行中
    });

    let oddsMap = {};
    if (onlyCrownOdds) {
      const matchIds = todayMatches.map((m) => String(m.matchId ?? m.match_id ?? m.gid)).filter(Boolean);
      oddsMap = await fetchCrownOddsByMatchIds(matchIds);
    }

    const result = todayMatches
      .map((m) => {
        const matchId = String(m.matchId ?? m.match_id ?? m.gid);
        const status = normalizeStatus(m.status);
        const period = derivePeriod(status, m);
        const crownOdds = oddsMap[matchId];
        const crownOddsAvailable = !!crownOdds && (
          (crownOdds.handicap||0) + (crownOdds.europeOdds||0) + (crownOdds.overUnder||0) + (crownOdds.handicapHalf||0) + (crownOdds.overUnderHalf||0)
        ) > 0;
        return {
          league: m.leagueName || m.league || '',
          home: m.homeName || m.home || '',
          away: m.awayName || m.away || '',
          matchId,
          matchTime: m.matchTime || m.match_time || 0,
          status,
          period,
          crownOddsAvailable,
        };
      })
      .filter((row) => (onlyCrownOdds ? row.crownOddsAvailable : true))
      .sort((a, b) => (a.matchTime || 0) - (b.matchTime || 0));

    console.log(JSON.stringify({ date, sport, lang: lang || undefined, count: result.length, matches: result }, null, 2));
  } catch (err) {
    console.error('❌ 运行失败:', err?.message || err);
    process.exit(1);
  }
})();

