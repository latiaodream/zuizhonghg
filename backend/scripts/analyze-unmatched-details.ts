import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

/**
 * 详细分析未匹配的 180 场比赛
 * 找出为什么这些比赛没有匹配到 iSports
 */

const API_KEY = process.env.ISPORTS_API_KEY;
const BASE_URL = 'http://api.isportsapi.com/sport/football';

interface CrownMatch {
  crown_gid: string;
  league: string;
  home: string;
  away: string;
  datetime: string;
}

interface IsportsMatch {
  matchId: string;
  leagueName: string;
  homeName: string;
  awayName: string;
  matchTime: number;
}

// 简繁转换
function toSimplified(text: string): string {
  const map: { [key: string]: string } = {
    '聯': '联', '賽': '赛', '組': '组', '級': '级', '盃': '杯',
    '爾': '尔', '維': '维', '納': '纳', '馬': '马', '達': '达',
    '頓': '顿', '諾': '诺', '漢': '汉', '倫': '伦', '斯': '斯',
    '羅': '罗', '薩': '萨', '巴': '巴', '塞': '塞', '隆': '隆',
    '拿': '拿', '瓦': '瓦', '亞': '亚', '哈': '哈', '歐': '欧',
    '洲': '洲', '冠': '冠', '軍': '军', '盟': '盟', '協': '协',
    '會': '会', '德': '德', '國': '国', '意': '意', '大': '大',
    '利': '利', '西': '西', '班': '班', '牙': '牙', '法': '法',
    '荷': '荷', '蘭': '兰', '葡': '葡', '萄': '萄', '比': '比',
    '時': '时', '瑞': '瑞', '典': '典', '挪': '挪', '威': '威',
    '丹': '丹', '麥': '麦', '日': '日', '本': '本', '韓': '韩',
  };

  return text.split('').map(char => map[char] || char).join('');
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/fc$/i, '')
    .replace(/足球俱乐部$/i, '')
    .replace(/足球队$/i, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

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
  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

async function main() {
  console.log('============================================================');
  console.log('🔍 详细分析未匹配的比赛');
  console.log('============================================================\n');

  if (!API_KEY) {
    console.error('❌ 请设置 ISPORTS_API_KEY 环境变量');
    process.exit(1);
  }

  // 1. 读取皇冠数据
  const crownGidsPath = path.resolve(process.cwd(), 'crown-gids.json');
  if (!fs.existsSync(crownGidsPath)) {
    console.error('❌ crown-gids.json 不存在');
    process.exit(1);
  }

  const crownData = JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8'));
  const crownMatches: CrownMatch[] = crownData.matches || [];
  console.log(`📊 皇冠比赛: ${crownMatches.length} 场\n`);

  // 2. 读取映射文件
  const mapPath = path.resolve(process.cwd(), '../fetcher-isports/data/crown-match-map.json');
  if (!fs.existsSync(mapPath)) {
    console.error('❌ crown-match-map.json 不存在');
    process.exit(1);
  }

  const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  const matchedGids = new Set<string>();
  (mapData.matches || []).forEach((m: any) => {
    matchedGids.add(String(m.crown_gid));
  });

  console.log(`📊 已匹配: ${matchedGids.size} 场`);
  console.log(`📊 未匹配: ${crownMatches.length - matchedGids.size} 场\n`);

  // 3. 找出未匹配的比赛
  const unmatchedCrown = crownMatches.filter(m => !matchedGids.has(String(m.crown_gid)));
  console.log(`🔍 分析 ${unmatchedCrown.length} 场未匹配比赛...\n`);

  // 4. 获取 iSports 数据
  console.log('📥 获取 iSports 数据...');
  const today = new Date();
  const dates: string[] = [];
  
  // 昨天 + 今天 + 未来7天
  for (let i = -1; i <= 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    dates.push(date.toISOString().split('T')[0]);
  }

  const allIsportsMatches: IsportsMatch[] = [];
  for (const date of dates) {
    try {
      const response = await axios.get(`${BASE_URL}/schedule/basic`, {
        params: { api_key: API_KEY, date },
        timeout: 30000,
      });

      if (response.data.code === 0) {
        const matches = response.data.data || [];
        allIsportsMatches.push(...matches);
        console.log(`  ${date}: ${matches.length} 场`);
      }
    } catch (error: any) {
      console.error(`  ${date}: 失败 - ${error.message}`);
    }
  }

  console.log(`\n✅ iSports 总计: ${allIsportsMatches.length} 场\n`);

  // 5. 分析每场未匹配的比赛
  console.log('============================================================');
  console.log('📋 未匹配比赛详细分析');
  console.log('============================================================\n');

  const reasons: { [key: string]: number } = {
    '队名差异大': 0,
    '联赛名不匹配': 0,
    'iSports无此比赛': 0,
    '时间差异大': 0,
  };

  const examples: any[] = [];

  unmatchedCrown.forEach((crown, index) => {
    const crownHomeNorm = normalizeText(toSimplified(crown.home));
    const crownAwayNorm = normalizeText(toSimplified(crown.away));
    const crownLeagueNorm = normalizeText(toSimplified(crown.league));

    let bestMatch: any = null;
    let bestScore = 0;

    allIsportsMatches.forEach((isports) => {
      const isportsHomeNorm = normalizeText(isports.homeName);
      const isportsAwayNorm = normalizeText(isports.awayName);
      const isportsLeagueNorm = normalizeText(isports.leagueName);

      const homeSim = similarity(crownHomeNorm, isportsHomeNorm);
      const awaySim = similarity(crownAwayNorm, isportsAwayNorm);
      const leagueSim = similarity(crownLeagueNorm, isportsLeagueNorm);

      const score = homeSim * 0.4 + awaySim * 0.4 + leagueSim * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          isports,
          homeSim,
          awaySim,
          leagueSim,
          score,
        };
      }
    });

    // 判断原因
    let reason = 'iSports无此比赛';
    if (bestMatch && bestScore > 0.3) {
      if (bestMatch.leagueSim < 0.5) {
        reason = '联赛名不匹配';
      } else if (bestMatch.homeSim < 0.6 || bestMatch.awaySim < 0.6) {
        reason = '队名差异大';
      } else {
        reason = '时间差异大';
      }
    }

    reasons[reason]++;

    // 保存前20个示例
    if (examples.length < 20) {
      examples.push({
        crown,
        bestMatch,
        reason,
      });
    }
  });

  // 6. 输出统计
  console.log('📊 未匹配原因统计:\n');
  Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      const percentage = ((count / unmatchedCrown.length) * 100).toFixed(1);
      console.log(`   ${reason}: ${count} 场 (${percentage}%)`);
    });

  // 7. 输出示例
  console.log('\n============================================================');
  console.log('📋 未匹配比赛示例（前20场）');
  console.log('============================================================\n');

  examples.forEach((ex, index) => {
    console.log(`${index + 1}. 【${ex.reason}】`);
    console.log(`   皇冠: ${ex.crown.league} | ${ex.crown.home} vs ${ex.crown.away}`);
    console.log(`   时间: ${ex.crown.datetime}`);
    
    if (ex.bestMatch && ex.bestMatch.score > 0.2) {
      console.log(`   最佳候选 (相似度: ${(ex.bestMatch.score * 100).toFixed(1)}%):`);
      console.log(`   iSports: ${ex.bestMatch.isports.leagueName} | ${ex.bestMatch.isports.homeName} vs ${ex.bestMatch.isports.awayName}`);
      console.log(`   详细: 主队${(ex.bestMatch.homeSim * 100).toFixed(0)}% 客队${(ex.bestMatch.awaySim * 100).toFixed(0)}% 联赛${(ex.bestMatch.leagueSim * 100).toFixed(0)}%`);
    } else {
      console.log(`   ❌ 无合适候选`);
    }
    console.log('');
  });

  console.log('============================================================');
  console.log('✅ 分析完成');
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('❌ 分析失败:', error);
  process.exit(1);
});

