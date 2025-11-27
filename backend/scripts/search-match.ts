import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/**
 * 搜索指定比赛在皇冠和 iSports 中的数据
 */

interface SearchResult {
  source: string;
  league: string;
  home: string;
  away: string;
  time: string;
  gid?: string;
  matchId?: string;
  fullData?: any;
}

// 简繁体转换映射表（常用字）
const s2tMap: { [key: string]: string } = {
  '尔': '爾', '哈': '哈', '瓦': '瓦', '亚': '亞',
  '沙特': '沙特', '联赛': '聯賽', '组': '組',
  '曼联': '曼聯', '利物浦': '利物浦', '皇马': '皇馬',
  '巴萨': '巴薩', '国际': '國際', '米兰': '米蘭',
};

function toTraditional(text: string): string {
  let result = text;
  for (const [s, t] of Object.entries(s2tMap)) {
    result = result.replace(new RegExp(s, 'g'), t);
  }
  return result;
}

function normalizeText(text: string): string {
  const lower = text.toLowerCase().replace(/\s+/g, '');
  // 同时返回简体和繁体的标准化版本
  return lower;
}

function normalizeTextWithVariants(text: string): string[] {
  const normalized = normalizeText(text);
  const traditional = normalizeText(toTraditional(text));
  // 返回简体和繁体两个版本
  return [normalized, traditional];
}

function searchInCrown(homeTeam: string, awayTeam: string, league?: string): SearchResult[] {
  const crownGidsPath = path.resolve(process.cwd(), 'crown-gids.json');

  if (!fs.existsSync(crownGidsPath)) {
    console.log('❌ crown-gids.json 不存在');
    return [];
  }

  const crownData = JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8'));
  const matches = crownData.matches || [];

  // 获取简繁体变体
  const homeVariants = normalizeTextWithVariants(homeTeam);
  const awayVariants = normalizeTextWithVariants(awayTeam);
  const leagueVariants = league ? normalizeTextWithVariants(league) : [];

  const results: SearchResult[] = [];

  matches.forEach((match: any) => {
    const matchHomeNorm = normalizeText(match.home || '');
    const matchAwayNorm = normalizeText(match.away || '');
    const matchLeagueNorm = normalizeText(match.league || '');

    // 检查是否匹配（支持简繁体）
    const homeMatches = homeVariants.some(v => matchHomeNorm.includes(v) || v.includes(matchHomeNorm));
    const awayMatches = awayVariants.some(v => matchAwayNorm.includes(v) || v.includes(matchAwayNorm));
    const homeMatchesReverse = homeVariants.some(v => matchAwayNorm.includes(v) || v.includes(matchAwayNorm));
    const awayMatchesReverse = awayVariants.some(v => matchHomeNorm.includes(v) || v.includes(matchHomeNorm));
    const leagueMatches = leagueVariants.length === 0 || leagueVariants.some(v =>
      matchLeagueNorm.includes(v) || v.includes(matchLeagueNorm)
    );

    // 精确匹配
    if (homeMatches && awayMatches && leagueMatches) {
      results.push({
        source: 'Crown',
        league: match.league,
        home: match.home,
        away: match.away,
        time: match.datetime,
        gid: match.crown_gid,
        fullData: match,
      });
    }
    // 反向匹配（主客队可能颠倒）
    else if (homeMatchesReverse && awayMatchesReverse && leagueMatches) {
      results.push({
        source: 'Crown (主客队颠倒)',
        league: match.league,
        home: match.home,
        away: match.away,
        time: match.datetime,
        gid: match.crown_gid,
        fullData: match,
      });
    }
  });

  return results;
}

function searchInIsports(homeTeam: string, awayTeam: string, league?: string): SearchResult[] {
  const latestMatchesPath = path.resolve(process.cwd(), '../fetcher-isports/data/latest-matches.json');
  
  if (!fs.existsSync(latestMatchesPath)) {
    console.log('❌ latest-matches.json 不存在');
    return [];
  }

  const latestData = JSON.parse(fs.readFileSync(latestMatchesPath, 'utf-8'));
  const matches = latestData.matches || [];

  const homeNorm = normalizeText(homeTeam);
  const awayNorm = normalizeText(awayTeam);
  const leagueNorm = league ? normalizeText(league) : '';

  const results: SearchResult[] = [];

  matches.forEach((match: any) => {
    const matchHome = match.home || match.team_h || match.homeName || '';
    const matchAway = match.away || match.team_c || match.awayName || '';
    const matchLeague = match.league || match.league_name || match.leagueName || '';

    const matchHomeNorm = normalizeText(matchHome);
    const matchAwayNorm = normalizeText(matchAway);
    const matchLeagueNorm = normalizeText(matchLeague);

    // 精确匹配
    if (matchHomeNorm.includes(homeNorm) && matchAwayNorm.includes(awayNorm)) {
      if (!league || matchLeagueNorm.includes(leagueNorm)) {
        results.push({
          source: 'iSports',
          league: matchLeague,
          home: matchHome,
          away: matchAway,
          time: match.timer || match.time || match.matchTime || '',
          matchId: match.gid || match.matchId,
          fullData: match,
        });
      }
    }
    // 反向匹配
    else if (matchHomeNorm.includes(awayNorm) && matchAwayNorm.includes(homeNorm)) {
      if (!league || matchLeagueNorm.includes(leagueNorm)) {
        results.push({
          source: 'iSports (主客队颠倒)',
          league: matchLeague,
          home: matchHome,
          away: matchAway,
          time: match.timer || match.time || match.matchTime || '',
          matchId: match.gid || match.matchId,
          fullData: match,
        });
      }
    }
    // 模糊匹配
    else if (
      (matchHomeNorm.includes(homeNorm) || homeNorm.includes(matchHomeNorm)) &&
      (matchAwayNorm.includes(awayNorm) || awayNorm.includes(matchAwayNorm))
    ) {
      if (!league || matchLeagueNorm.includes(leagueNorm) || leagueNorm.includes(matchLeagueNorm)) {
        results.push({
          source: 'iSports (模糊匹配)',
          league: matchLeague,
          home: matchHome,
          away: matchAway,
          time: match.timer || match.time || match.matchTime || '',
          matchId: match.gid || match.matchId,
          fullData: match,
        });
      }
    }
  });

  return results;
}

function searchByLeague(league: string): { crown: SearchResult[], isports: SearchResult[] } {
  const crownGidsPath = path.resolve(process.cwd(), 'crown-gids.json');
  const latestMatchesPath = path.resolve(process.cwd(), '../fetcher-isports/data/latest-matches.json');

  const leagueNorm = normalizeText(league);
  const crownResults: SearchResult[] = [];
  const isportsResults: SearchResult[] = [];

  // 搜索皇冠
  if (fs.existsSync(crownGidsPath)) {
    const crownData = JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8'));
    const matches = crownData.matches || [];

    matches.forEach((match: any) => {
      const matchLeagueNorm = normalizeText(match.league || '');
      if (matchLeagueNorm.includes(leagueNorm) || leagueNorm.includes(matchLeagueNorm)) {
        crownResults.push({
          source: 'Crown',
          league: match.league,
          home: match.home,
          away: match.away,
          time: match.datetime,
          gid: match.crown_gid,
          fullData: match,
        });
      }
    });
  }

  // 搜索 iSports
  if (fs.existsSync(latestMatchesPath)) {
    const latestData = JSON.parse(fs.readFileSync(latestMatchesPath, 'utf-8'));
    const matches = latestData.matches || [];

    matches.forEach((match: any) => {
      const matchLeague = match.league || match.league_name || match.leagueName || '';
      const matchLeagueNorm = normalizeText(matchLeague);
      
      if (matchLeagueNorm.includes(leagueNorm) || leagueNorm.includes(matchLeagueNorm)) {
        const matchHome = match.home || match.team_h || match.homeName || '';
        const matchAway = match.away || match.team_c || match.awayName || '';
        
        isportsResults.push({
          source: 'iSports',
          league: matchLeague,
          home: matchHome,
          away: matchAway,
          time: match.timer || match.time || match.matchTime || '',
          matchId: match.gid || match.matchId,
          fullData: match,
        });
      }
    });
  }

  return { crown: crownResults, isports: isportsResults };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('使用方法:');
    console.log('  搜索比赛: npm run search:match -- <主队> <客队> [联赛]');
    console.log('  搜索联赛: npm run search:match -- --league <联赛名>');
    console.log('');
    console.log('示例:');
    console.log('  npm run search:match -- 安瓦尔 亚哈');
    console.log('  npm run search:match -- 安瓦尔 亚哈 沙特');
    console.log('  npm run search:match -- --league 沙特甲组联赛');
    process.exit(0);
  }

  console.log('============================================================');
  console.log('🔍 搜索比赛');
  console.log('============================================================\n');

  if (args[0] === '--league') {
    // 按联赛搜索
    const league = args.slice(1).join(' ');
    console.log(`搜索联赛: ${league}\n`);

    const results = searchByLeague(league);

    console.log(`📊 皇冠中找到 ${results.crown.length} 场比赛:\n`);
    results.crown.slice(0, 10).forEach((result, index) => {
      console.log(`${index + 1}. ${result.home} vs ${result.away}`);
      console.log(`   时间: ${result.time}`);
      console.log(`   GID: ${result.gid}\n`);
    });

    if (results.crown.length > 10) {
      console.log(`... 还有 ${results.crown.length - 10} 场\n`);
    }

    console.log(`📊 iSports 中找到 ${results.isports.length} 场比赛:\n`);
    results.isports.slice(0, 10).forEach((result, index) => {
      console.log(`${index + 1}. ${result.home} vs ${result.away}`);
      console.log(`   时间: ${result.time}`);
      console.log(`   Match ID: ${result.matchId}\n`);
    });

    if (results.isports.length > 10) {
      console.log(`... 还有 ${results.isports.length - 10} 场\n`);
    }

  } else {
    // 按队名搜索
    const homeTeam = args[0];
    const awayTeam = args[1];
    const league = args[2];

    console.log(`搜索: ${homeTeam} vs ${awayTeam}`);
    if (league) {
      console.log(`联赛: ${league}`);
    }
    console.log('');

    const crownResults = searchInCrown(homeTeam, awayTeam, league);
    const isportsResults = searchInIsports(homeTeam, awayTeam, league);

    console.log(`📊 皇冠中找到 ${crownResults.length} 场比赛:\n`);
    crownResults.forEach((result, index) => {
      console.log(`${index + 1}. [${result.source}]`);
      console.log(`   联赛: ${result.league}`);
      console.log(`   对阵: ${result.home} vs ${result.away}`);
      console.log(`   时间: ${result.time}`);
      console.log(`   GID: ${result.gid}\n`);
    });

    console.log(`📊 iSports 中找到 ${isportsResults.length} 场比赛:\n`);
    isportsResults.forEach((result, index) => {
      console.log(`${index + 1}. [${result.source}]`);
      console.log(`   联赛: ${result.league}`);
      console.log(`   对阵: ${result.home} vs ${result.away}`);
      console.log(`   时间: ${result.time}`);
      console.log(`   Match ID: ${result.matchId}\n`);
    });

    if (crownResults.length === 0 && isportsResults.length === 0) {
      console.log('❌ 未找到匹配的比赛\n');
      console.log('💡 提示:');
      console.log('   - 尝试只输入部分队名');
      console.log('   - 检查队名拼写');
      console.log('   - 使用 --league 参数搜索整个联赛\n');
    }
  }

  console.log('============================================================');
  console.log('✅ 搜索完成');
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('❌ 搜索失败:', error);
  process.exit(1);
});

