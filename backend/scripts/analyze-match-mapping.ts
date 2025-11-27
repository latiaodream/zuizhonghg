import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/**
 * 分析皇冠与 iSports 匹配情况
 * 找出匹配不上的原因，提供优化建议
 */

interface CrownMatch {
  crown_gid: string;
  league: string;
  home: string;
  away: string;
  datetime: string;
  source_showtype: string;
}

interface IsportsMatch {
  matchId: string;
  leagueName: string;
  homeName: string;
  awayName: string;
  matchTime: string;
}

interface MappingEntry {
  isports_match_id: string;
  crown_gid: string;
  similarity: number;
  crown: any;
  isports: any;
}

// 计算字符串相似度（Levenshtein 距离）
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[len1][len2];
}

function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  return 1 - distance / maxLen;
}

// 标准化队名（去除常见后缀、空格等）
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/fc$/i, '')
    .replace(/足球俱乐部$/i, '')
    .replace(/足球队$/i, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

// 计算匹配分数
function calculateMatchScore(crown: CrownMatch, isports: IsportsMatch): number {
  const crownHomeNorm = normalizeTeamName(crown.home);
  const crownAwayNorm = normalizeTeamName(crown.away);
  const isportsHomeNorm = normalizeTeamName(isports.homeName);
  const isportsAwayNorm = normalizeTeamName(isports.awayName);

  // 主队相似度
  const homeSim = similarity(crownHomeNorm, isportsHomeNorm);
  // 客队相似度
  const awaySim = similarity(crownAwayNorm, isportsAwayNorm);
  // 联赛相似度
  const leagueSim = similarity(
    normalizeTeamName(crown.league),
    normalizeTeamName(isports.leagueName)
  );

  // 综合分数：主队40% + 客队40% + 联赛20%
  return homeSim * 0.4 + awaySim * 0.4 + leagueSim * 0.2;
}

async function main() {
  console.log('============================================================');
  console.log('🔍 分析皇冠与 iSports 匹配情况');
  console.log('============================================================\n');

  // 1. 读取数据文件
  const crownGidsPath = path.resolve(process.cwd(), 'crown-gids.json');
  const crownMapPath = path.resolve(process.cwd(), '../fetcher-isports/data/crown-match-map.json');
  const latestMatchesPath = path.resolve(process.cwd(), '../fetcher-isports/data/latest-matches.json');

  if (!fs.existsSync(crownGidsPath)) {
    console.log('❌ crown-gids.json 不存在，请先运行: npm run crown:fetch-gids');
    process.exit(1);
  }

  const crownData = JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8'));
  const crownMatches: CrownMatch[] = crownData.matches || [];

  let mappingData: any = { matched: [], unmatched: [] };
  if (fs.existsSync(crownMapPath)) {
    mappingData = JSON.parse(fs.readFileSync(crownMapPath, 'utf-8'));
  }

  // 从 latest-matches.json 中提取 iSports 数据
  let isportsMatches: any[] = [];
  if (fs.existsSync(latestMatchesPath)) {
    const latestData = JSON.parse(fs.readFileSync(latestMatchesPath, 'utf-8'));
    isportsMatches = (latestData.matches || []).filter((m: any) => m.source === 'isports');
  }

  console.log(`📊 数据统计:`);
  console.log(`   皇冠比赛: ${crownMatches.length} 场`);
  console.log(`   iSports 比赛: ${isportsMatches.length} 场`);
  console.log(`   已匹配: ${mappingData.matched?.length || 0} 场`);
  console.log(`   未匹配: ${mappingData.unmatched?.length || 0} 场\n`);

  // 2. 分析未匹配的比赛
  console.log('============================================================');
  console.log('📋 未匹配比赛分析');
  console.log('============================================================\n');

  const unmatchedCrown = mappingData.unmatched || [];

  // 定义在外层作用域
  const reasonStats: { [key: string]: number } = {};
  const unmatchedByLeague: { [key: string]: CrownMatch[] } = {};
  const potentialMatches: any[] = [];

  if (unmatchedCrown.length === 0) {
    console.log('✅ 所有皇冠比赛都已匹配！\n');
  } else {
    console.log(`共有 ${unmatchedCrown.length} 场皇冠比赛未匹配\n`);

    unmatchedCrown.forEach((match: CrownMatch) => {
      // 按联赛分类
      if (!unmatchedByLeague[match.league]) {
        unmatchedByLeague[match.league] = [];
      }
      unmatchedByLeague[match.league].push(match);
    });

    // 显示按联赛分类的未匹配比赛
    console.log('📊 按联赛分类的未匹配比赛:\n');
    const sortedLeagues = Object.entries(unmatchedByLeague)
      .sort((a, b) => b[1].length - a[1].length);

    sortedLeagues.forEach(([league, matches]) => {
      console.log(`   ${league}: ${matches.length} 场`);
    });
    console.log('');

    // 3. 尝试为未匹配的比赛找到最佳候选
    console.log('============================================================');
    console.log('🔎 为未匹配比赛寻找最佳候选');
    console.log('============================================================\n');

    unmatchedCrown.slice(0, 20).forEach((crownMatch: CrownMatch) => {
      let bestMatch: any = null;
      let bestScore = 0;

      isportsMatches.forEach((isportsMatch) => {
        const isportsData = {
          matchId: isportsMatch.gid || isportsMatch.matchId,
          leagueName: isportsMatch.league || isportsMatch.leagueName,
          homeName: isportsMatch.home || isportsMatch.team_h || isportsMatch.homeName,
          awayName: isportsMatch.away || isportsMatch.team_c || isportsMatch.awayName,
          matchTime: isportsMatch.timer || isportsMatch.time || isportsMatch.matchTime,
        };
        const score = calculateMatchScore(crownMatch, isportsData);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = isportsData;
        }
      });

      if (bestMatch && bestScore > 0.3) {
        potentialMatches.push({
          crown: crownMatch,
          isports: bestMatch,
          score: bestScore,
        });
      }

      console.log(`皇冠: ${crownMatch.league} | ${crownMatch.home} vs ${crownMatch.away}`);
      if (bestMatch && bestScore > 0.3) {
        console.log(`  ↓ 最佳候选 (相似度: ${(bestScore * 100).toFixed(1)}%)`);
        console.log(`iSports: ${bestMatch.leagueName} | ${bestMatch.homeName} vs ${bestMatch.awayName}`);
        console.log('');
      } else {
        console.log(`  ❌ 无合适候选 (最高相似度: ${(bestScore * 100).toFixed(1)}%)`);
        console.log('');
      }
    });

    if (unmatchedCrown.length > 20) {
      console.log(`... 还有 ${unmatchedCrown.length - 20} 场未显示\n`);
    }

    // 4. 分析匹配失败的原因
    console.log('============================================================');
    console.log('📈 匹配失败原因分析');
    console.log('============================================================\n');

    const reasons: { [key: string]: number } = {
      '队名差异过大': 0,
      '联赛名不匹配': 0,
      'iSports无此比赛': 0,
      '时间差异过大': 0,
    };

    unmatchedCrown.forEach((crownMatch: CrownMatch) => {
      let bestScore = 0;
      let bestIsports: any = null;

      isportsMatches.forEach((isportsMatch) => {
        const isportsData = {
          matchId: isportsMatch.gid || isportsMatch.matchId,
          leagueName: isportsMatch.league || isportsMatch.leagueName,
          homeName: isportsMatch.home || isportsMatch.team_h || isportsMatch.homeName,
          awayName: isportsMatch.away || isportsMatch.team_c || isportsMatch.awayName,
          matchTime: isportsMatch.timer || isportsMatch.time || isportsMatch.matchTime,
        };
        const score = calculateMatchScore(crownMatch, isportsData);
        if (score > bestScore) {
          bestScore = score;
          bestIsports = isportsData;
        }
      });

      if (bestScore < 0.3) {
        reasons['iSports无此比赛']++;
      } else if (bestScore < 0.5) {
        const leagueSim = similarity(
          normalizeTeamName(crownMatch.league),
          normalizeTeamName(bestIsports.leagueName)
        );
        if (leagueSim < 0.5) {
          reasons['联赛名不匹配']++;
        } else {
          reasons['队名差异过大']++;
        }
      }
    });

    Object.entries(reasons).forEach(([reason, count]) => {
      if (count > 0) {
        console.log(`   ${reason}: ${count} 场 (${((count / unmatchedCrown.length) * 100).toFixed(1)}%)`);
      }
    });
    console.log('');

    // 5. 优化建议
    console.log('============================================================');
    console.log('💡 优化建议');
    console.log('============================================================\n');

    console.log('1. 队名标准化优化:');
    console.log('   - 建立队名别名映射表（如：曼联 = Manchester United = Man Utd）');
    console.log('   - 处理中英文队名对照');
    console.log('   - 去除常见后缀（FC, 足球俱乐部等）\n');

    console.log('2. 联赛名标准化:');
    console.log('   - 建立联赛别名映射（如：英超 = Premier League = EPL）');
    console.log('   - 统一联赛名称格式\n');

    console.log('3. 时间匹配优化:');
    console.log('   - 允许一定时间误差（如 ±30分钟）');
    console.log('   - 考虑时区差异\n');

    console.log('4. 手动映射:');
    console.log('   - 为常见的未匹配比赛建立手动映射表');
    console.log('   - 定期更新映射规则\n');

    if (potentialMatches.length > 0) {
      console.log(`5. 可以考虑降低匹配阈值:`);
      console.log(`   - 当前有 ${potentialMatches.length} 场比赛相似度在 30%-60% 之间`);
      console.log(`   - 可以人工审核后添加到映射表\n`);
    }
  }

  // 6. 生成优化建议报告
  const reportPath = path.resolve(process.cwd(), 'match-analysis-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    totalCrown: crownMatches.length,
    totalIsports: isportsMatches.length,
    matched: mappingData.matched?.length || 0,
    unmatched: unmatchedCrown.length,
    matchRate: ((mappingData.matched?.length || 0) / crownMatches.length * 100).toFixed(2) + '%',
    unmatchedByLeague: Object.entries(unmatchedByLeague).map(([league, matches]) => ({
      league,
      count: matches.length,
    })),
    potentialMatches: potentialMatches.slice(0, 50),
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 详细报告已保存到: ${reportPath}\n`);

  console.log('============================================================');
  console.log('✅ 分析完成');
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('❌ 分析失败:', error);
  process.exit(1);
});

