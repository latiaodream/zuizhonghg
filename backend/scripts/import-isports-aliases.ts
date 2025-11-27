import 'dotenv/config';
import axios from 'axios';
import { nameAliasService } from '../src/services/name-alias-service';
import { ISportsLanguageService } from '../src/services/isports-language';

/**
 * 将 iSports 赛事（仅皇冠有赔率的）中的联赛与球队名称导入本地别名库
 * - 默认足球(sport=ft)
 * - 仅保留未结束(status !== -1 && status !== 3)的比赛
 * - 仅保留有皇冠(companyId=3)赔率的比赛
 * - 使用 iSports 语言包 API 获取繁体中文名称
 *
 * 运行示例：
 *   ISPORTS_API_KEY=你的Key npm run aliases:import-isports
 * 可选参数：
 *   --days=30           抓取天数（默认 30 天，从今天开始往后）
 *   --date=YYYY-MM-DD   指定起始日期（UTC），默认今天
 *   --sport=ft|bk       目前仅实现 ft
 */

function getArg(name: string, def?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return def;
  return arg.split('=')[1];
}

const API_KEY = process.env.ISPORTS_API_KEY || getArg('apiKey') || '';
const sport = (getArg('sport', 'ft') || 'ft').toLowerCase();
const startDate = getArg('date') || new Date().toISOString().split('T')[0];
const days = parseInt(getArg('days', '30') || '30');

if (!API_KEY) {
  console.error('❌ 缺少 ISPORTS_API_KEY（或 --apiKey）');
  process.exit(1);
}

if (sport !== 'ft') {
  console.warn('⚠️  当前脚本仅实现足球(ft)，其它运动暂未实现');
}

const BASE_URL = sport === 'bk'
  ? 'http://api.isportsapi.com/sport/basketball'
  : 'http://api.isportsapi.com/sport/football';

// 生成日期列表
function generateDateList(start: string, numDays: number): string[] {
  const dates: string[] = [];
  const startDateObj = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < numDays; i++) {
    const date = new Date(startDateObj);
    date.setUTCDate(date.getUTCDate() + i);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
}

const normalizeStatus = (value: any): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

async function fetchScheduleByDate(date: string) {
  const params: any = { api_key: API_KEY, date };
  try {
    const res = await axios.get(`${BASE_URL}/schedule/basic`, { params, timeout: 30000 });
    if (res.data?.code !== 0) {
      throw new Error(`iSports /schedule/basic error: ${JSON.stringify(res.data)}`);
    }
    return res.data.data || [];
  } catch (error: any) {
    console.error(`❌ 请求 ${date} 失败:`, error.message);
    if (error.response) {
      console.error('   状态码:', error.response.status);
      console.error('   响应:', JSON.stringify(error.response.data).slice(0, 200));
    }
    return [];
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log('============================================================');
  console.log('🚀 导入 iSports 赛事到本地别名库（仅皇冠）');
  console.log('============================================================');
  console.log(`起始日期: ${startDate}  天数: ${days}  运动: ${sport}`);

  // 1. 初始化语言包服务
  console.log('\n📦 初始化 iSports 语言包服务...');
  const languageService = new ISportsLanguageService(API_KEY, './data');
  await languageService.ensureCache();

  // 2. 生成日期列表
  const dateList = generateDateList(startDate, days);
  console.log(`\n📅 将抓取 ${dateList.length} 天的赛程: ${dateList[0]} ~ ${dateList[dateList.length - 1]}`);

  // 3. 获取所有日期的赛程（英文）
  console.log('\n📥 获取赛程...');
  let allSchedule: any[] = [];
  for (let i = 0; i < dateList.length; i++) {
    const date = dateList[i];
    console.log(`  [${i + 1}/${dateList.length}] ${date}...`);
    const schedule = await fetchScheduleByDate(date);
    allSchedule = allSchedule.concat(schedule);
    // 避免频率限制，每次请求间隔 1 秒
    if (i < dateList.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(`✅ 共获取 ${allSchedule.length} 场比赛`);

  const schedule = allSchedule;
  const candidates = schedule
    .filter((m: any) => {
      const status = normalizeStatus(m.status);
      return status !== -1 && status !== 3; // 未开赛或进行中
    })
    .map((m: any) => ({
      matchId: String(m.matchId ?? m.match_id ?? m.gid ?? ''),
      leagueId: String(m.leagueId ?? m.league_id ?? ''),
      leagueName: m.leagueName || m.league || '',
      homeId: String(m.homeId ?? m.home_id ?? ''),
      homeName: m.homeName || m.home || '',
      awayId: String(m.awayId ?? m.away_id ?? ''),
      awayName: m.awayName || m.away || '',
    }))
    .filter((m: any) => m.matchId);

  console.log(`\n📋 候选比赛: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('⚠️  无候选比赛，结束');
    return;
  }

  // 4. 边查询边导入（分批处理）
  console.log('\n👑 开始分批查询皇冠赔率并导入...');
  const batches = chunk(candidates, 100);
  console.log(`   总批次: ${batches.length}，每批 100 场比赛`);

  let totalCrownMatches = 0;
  let totalLeaguesProcessed = 0;
  let totalTeamsProcessed = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchMatchIds = batch.map((c: any) => c.matchId);

    try {
      // 显示进度
      console.log(`\n📦 批次 [${i + 1}/${batches.length}] 查询 ${batchMatchIds.length} 场比赛...`);

      // 查询这批比赛的皇冠赔率
      const res = await axios.get(`${BASE_URL}/odds/all`, {
        params: { api_key: API_KEY, companyId: '3', matchId: batchMatchIds.join(',') },
        timeout: 15000,
      });

      if (res.data?.code !== 0) {
        console.warn(`⚠️  批次 [${i + 1}/${batches.length}] API 返回错误，跳过`);
        continue;
      }

      // 提取有皇冠赔率的 matchId
      const crownMatchIds = new Set<string>();
      const d = res.data?.data || {};
      const add = (rows?: string[]) => {
        (rows || []).forEach((row) => {
          const parts = String(row).split(',');
          const matchId = parts[0];
          if (matchId) crownMatchIds.add(String(matchId));
        });
      };
      add(d.handicap);
      add(d.europeOdds);
      add(d.overUnder);
      add(d.handicapHalf);
      add(d.overUnderHalf);

      const crownMatches = batch.filter((c: any) => crownMatchIds.has(c.matchId));
      totalCrownMatches += crownMatches.length;
      console.log(`   ✅ 找到 ${crownMatches.length} 场有皇冠赔率`);

      if (crownMatches.length === 0) {
        console.log(`   ⏭️  本批次无皇冠赔率，跳过导入`);
        continue;
      }

      // 收集本批次的联赛和球队（不去重，让数据库处理）
      const leagueIdToName = new Map<string, string>();
      const teamIdToName = new Map<string, string>();

      crownMatches.forEach((m: any) => {
        if (m.leagueId && m.leagueName) {
          leagueIdToName.set(m.leagueId, m.leagueName);
        }
        if (m.homeId && m.homeName) {
          teamIdToName.set(m.homeId, m.homeName);
        }
        if (m.awayId && m.awayName) {
          teamIdToName.set(m.awayId, m.awayName);
        }
      });

      // 导入联赛（每个都尝试插入/更新）
      if (leagueIdToName.size > 0) {
        console.log(`   📝 处理 ${leagueIdToName.size} 个联赛...`);
        for (const [leagueId, leagueName] of leagueIdToName) {
          try {
            const nameEn = leagueName || '';
            const nameZhTw = languageService.getLeagueName(leagueId) || '';

            if (!nameEn && !nameZhTw) continue;

            await nameAliasService.createLeagueAlias({
              nameEn: nameEn || undefined,
              nameZhTw: nameZhTw || undefined,
              aliases: [],
            });
            totalLeaguesProcessed++;
          } catch (e: any) {
            // 忽略错误，继续处理
          }
        }
      }

      // 导入球队（每个都尝试插入/更新）
      if (teamIdToName.size > 0) {
        console.log(`   📝 处理 ${teamIdToName.size} 个球队...`);
        for (const [teamId, teamName] of teamIdToName) {
          try {
            const nameEn = teamName || '';
            const nameZhTw = languageService.getTeamName(teamId) || '';

            if (!nameEn && !nameZhTw) continue;

            await nameAliasService.createTeamAlias({
              nameEn: nameEn || undefined,
              nameZhTw: nameZhTw || undefined,
              aliases: [],
            });
            totalTeamsProcessed++;
          } catch (e: any) {
            // 忽略错误，继续处理
          }
        }
      }

      console.log(`   📊 当前进度: 已处理 ${totalCrownMatches} 场有皇冠赔率的比赛，处理 ${totalLeaguesProcessed} 次联赛，${totalTeamsProcessed} 次球队`);

    } catch (error: any) {
      console.error(`⚠️  批次 [${i + 1}/${batches.length}] 处理失败:`, error.message);
      console.log(`   💾 已保存的数据不会丢失，继续处理下一批次...`);
    }

    // 请求间隔
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log('\n============================================================');
  console.log(`✅ 导入完成！`);
  console.log(`📊 统计：`);
  console.log(`   - 抓取天数: ${dateList.length} 天 (${dateList[0]} ~ ${dateList[dateList.length - 1]})`);
  console.log(`   - 总比赛数: ${allSchedule.length} 场`);
  console.log(`   - 候选比赛: ${candidates.length} 场`);
  console.log(`   - 有皇冠赔率: ${totalCrownMatches} 场`);
  console.log(`   - 处理联赛: ${totalLeaguesProcessed} 次（包含新增和更新）`);
  console.log(`   - 处理球队: ${totalTeamsProcessed} 次（包含新增和更新）`);
  console.log('💡 提示：繁体中文来自 iSports 语言包，英文来自赛程 API');
  console.log('💡 提示：请在页面上手动填写"皇冠简体"字段');
  console.log('💡 提示：重复运行会自动合并更新，不会覆盖已有数据');
}

main().catch((err) => {
  console.error('❌ 执行失败:', err?.message || err);
  process.exit(1);
});

