import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/**
 * 从 fetcher-isports 的数据文件中提取皇冠赛事信息
 *
 * 改进说明：
 * - 不再使用皇冠API直接抓取（避免账号被封）
 * - 从 fetcher-isports/data/latest-matches.json 读取数据
 * - fetcher-isports 使用 iSportsAPI，不会导致账号被封
 */

type CrownMatch = {
  crown_gid: string;
  league: string;
  league_id: string;
  home: string;
  away: string;
  datetime: string;
  raw: any;
  source_showtype: string;
};

async function main() {
  const outputFile = process.env.CROWN_GID_OUTPUT || path.resolve(process.cwd(), 'crown-gids.json');

  console.log('🔄 从 fetcher-isports 读取赛事数据...');
  console.log('💡 此脚本不再使用皇冠API，避免账号被封\n');

  // 尝试从多个可能的位置读取 fetcher-isports 的数据
  const possiblePaths = [
    path.resolve(process.cwd(), '../fetcher-isports/data/latest-matches.json'),
    path.resolve(process.cwd(), 'fetcher-isports/data/latest-matches.json'),
    path.resolve('/www/wwwroot/aibcbot.top/fetcher-isports/data/latest-matches.json'),
  ];

  let fetcherData: any = null;
  let usedPath: string = '';

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        fetcherData = JSON.parse(fileContent);
        usedPath = filePath;
        console.log(`✅ 从 ${filePath} 读取数据成功`);
        break;
      } catch (error: any) {
        console.warn(`⚠️ 读取 ${filePath} 失败: ${error.message}`);
      }
    }
  }

  if (!fetcherData) {
    console.error('❌ 无法找到 fetcher-isports 的数据文件');
    console.error('   请确保 fetcher-isports 服务正在运行');
    console.error('   尝试的路径:');
    possiblePaths.forEach(p => console.error(`   - ${p}`));
    process.exit(1);
  }

  const matches = fetcherData.matches || [];
  const timestamp = fetcherData.timestamp || Date.now();
  const age = Date.now() - timestamp;

  console.log(`\n📊 数据统计:`);
  console.log(`   - 数据文件: ${usedPath}`);
  console.log(`   - 数据时间: ${new Date(timestamp).toLocaleString('zh-CN')}`);
  console.log(`   - 数据年龄: ${Math.floor(age / 1000)} 秒`);
  console.log(`   - 赛事总数: ${matches.length}`);

  // 检查数据是否过期（超过10分钟）
  if (age > 600000) {
    console.warn(`\n⚠️ 数据已过期 (${Math.floor(age / 60000)} 分钟前)`);
    console.warn('   建议检查 fetcher-isports 服务是否正常运行');
  }

  // 提取皇冠赛事信息
  const matchesMap: Map<string, CrownMatch> = new Map();
  let liveCount = 0;
  let todayCount = 0;
  let earlyCount = 0;

  for (const match of matches) {
    const crownGid = match.crown_gid || match.gid;
    if (!crownGid) continue;

    const gid = String(crownGid);
    if (matchesMap.has(gid)) continue;

    // 根据比赛状态判断 showtype
    let showtype = 'early';

    // 判断是否为滚球：state === 1 表示进行中
    const state = match.state ?? match.status;
    const isLive = state === 1 || state === '1';

    if (isLive) {
      showtype = 'live';
      liveCount++;
    } else {
      // 判断是今日还是早盘
      const matchTime = new Date(match.timer || match.time || match.match_time);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (matchTime >= today && matchTime < tomorrow) {
        showtype = 'today';
        todayCount++;
      } else {
        earlyCount++;
      }
    }

    matchesMap.set(gid, {
      crown_gid: gid,
      league: String(match.league || match.crown_league || ''),
      league_id: String(match.league_id || ''),
      home: String(match.team_h || match.home || match.crown_home || ''),
      away: String(match.team_c || match.away || match.crown_away || ''),
      datetime: String(match.timer || match.time || match.match_time || ''),
      raw: match,
      source_showtype: showtype,
    });
  }

  const crownMatches = Array.from(matchesMap.values());

  console.log(`\n📊 赛事分类:`);
  console.log(`   - 滚球 (live): ${liveCount} 场`);
  console.log(`   - 今日 (today): ${todayCount} 场`);
  console.log(`   - 早盘 (early): ${earlyCount} 场`);
  console.log(`   - 总计: ${crownMatches.length} 场`);

  const outputData = {
    generatedAt: new Date().toISOString(),
    source: 'fetcher-isports',
    source_timestamp: timestamp,
    matchCount: crownMatches.length,
    matches: crownMatches,
  };

  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`\n✅ 已保存到: ${outputFile}`);
  console.log(`\n💡 提示: 此脚本现在从 fetcher-isports 读取数据，不会导致皇冠账号被封`);
}

main().catch((error) => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
