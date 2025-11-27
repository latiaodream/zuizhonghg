import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parseISO, addDays, differenceInMinutes } from 'date-fns';
import { pinyin } from 'pinyin-pro';
// @ts-ignore - opencc-js 没有类型定义
import { Converter } from 'opencc-js';
import { getLanguageService } from '../src/services/isports-language';

interface CrownMatchFile {
  generatedAt: string;
  matchCount: number;
  matches: CrownMatch[];
}

interface CrownMatch {
  crown_gid: string;
  league: string;
  home: string;
  away: string;
  datetime: string;
  source_showtype?: string;
}

interface ISportsMatch {
  matchId: string;
  leagueName: string;
  leagueId: string;
  matchTime: number;
  status: number;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  raw?: any;
}

interface ISportsMatchExtended extends ISportsMatch {
  leagueNameTc?: string | null;
  leagueNameCn?: string | null;
  homeNameTc?: string | null;
  homeNameCn?: string | null;
  awayNameTc?: string | null;
  awayNameCn?: string | null;
}

interface MappingEntry {
  isports_match_id: string;
  crown_gid: string;
  similarity: number;
  time_diff_minutes: number;
  crown: {
    league: string;
    home: string;
    away: string;
    datetime: string;
    source_showtype?: string;
  };
  isports: {
    league: string;
    league_tc?: string;
    league_cn?: string;
    home: string;
    home_tc?: string;
    home_cn?: string;
    away: string;
    away_tc?: string;
    away_cn?: string;
    match_time: string;
  };
}

interface MatchContext {
  crown: CrownMatch;
  crownDate: Date | null;
}

// 常见球队别名映射
const TEAM_ALIASES: Record<string, string[]> = {
  // 英文球队
  'manchester united': ['man united', 'man utd', 'mufc'],
  'manchester city': ['man city', 'mcfc'],
  'tottenham': ['tottenham hotspur', 'spurs'],
  'newcastle': ['newcastle united'],
  'west ham': ['west ham united'],
  'brighton': ['brighton hove albion'],
  'nottingham forest': ['nott forest', 'notts forest'],
  'psv': ['psv eindhoven'],
  'hertha bsc': ['hertha berlin'],
  'bayern': ['bayern munich', 'fc bayern'],
  'borussia dortmund': ['bvb', 'dortmund'],
  'inter': ['inter milan', 'internazionale'],
  'ac milan': ['milan'],
  'atletico madrid': ['atletico', 'atm'],
  'athletic bilbao': ['athletic club'],
  'real sociedad': ['sociedad'],
  'paris saint germain': ['psg', 'paris sg'],
  'olympique marseille': ['marseille', 'om'],
  'olympique lyon': ['lyon', 'ol'],

  // 中文球队（繁体 → 拼音/英文）
  '青島海牛': ['qingdao hainiu', 'qingdao'],
  '武漢三鎮': ['wuhan three towns', 'wuhan'],
  '水原': ['suwon'],
  '大邱': ['daegu'],
  '忠南牙山': ['chungnam asan'],
  '天安城': ['cheonan city'],
  '北區': ['northern district'],
  '南區足球會': ['southern district'],
};

// 需要移除的无效词
const REMOVE_WORDS = [
  'fc', 'cf', 'sc', 'ac', 'as', 'cd', 'rcd', 'ud', 'sd',
  'u23', 'u21', 'u19', 'u18',
  'football club', 'soccer club', 'sporting club',
  'club', 'united', 'city', 'town', 'athletic',
  'reserves', 'ii', 'iii', 'b', 'c',
];

const REMOVE_WORD_REGEXES = REMOVE_WORDS.map(
  (word) => new RegExp(`\\b${word}\\b`, 'gi')
);

const DEFAULT_CROWN_FILE = path.resolve(process.cwd(), 'crown-gids.json');
const DEFAULT_OUTPUT = path.resolve(process.cwd(), '../fetcher-isports/data/crown-match-map.json');
const ISPORTS_API_BASE = 'http://api.isportsapi.com/sport/football';

const normalizeCache = new Map<string, string>();
const variantsCache = new Map<string, string[]>();
const aliasVariantMap = new Map<string, string[]>();
const jaccardCache = new Map<string, number>();
const ngramCache = new Map<string, string[]>();
const levenshteinCache = new Map<string, number>();
const variantSimilarityCache = new Map<string, number>();

/**
 * 标准化球队/联赛名称
 */
function normalizeTeamName(name: string): string {
  const cacheKey = name.toLowerCase().trim();
  const cached = normalizeCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let normalized = cacheKey;

  // 检查是否包含中文字符
  if (/[\u4e00-\u9fa5]/.test(normalized)) {
    // 转换为拼音（不带音调）
    normalized = pinyin(normalized, { toneType: 'none', type: 'array' }).join('');
  }

  // 移除无效词
  for (const regex of REMOVE_WORD_REGEXES) {
    normalized = normalized.replace(regex, ' ');
  }

  // 只保留字母和数字
  normalized = normalized.replace(/[^a-z0-9]/g, '');

  normalizeCache.set(cacheKey, normalized);
  return normalized;
}

function buildAliasVariantMap(): void {
  if (aliasVariantMap.size > 0) return;

  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const allNames = [canonical, ...aliases]
      .map((entry) => normalizeTeamName(entry))
      .filter((item) => !!item);

    if (allNames.length === 0) continue;

    const unique = Array.from(new Set(allNames));
    for (const variant of unique) {
      aliasVariantMap.set(variant, unique);
    }
  }
}

/**
 * 获取球队的所有可能名称（包括别名）
 */
function getTeamVariants(name: string): string[] {
  const cacheKey = name.toLowerCase().trim();
  const cached = variantsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const variants = new Set<string>();
  const normalized = normalizeTeamName(name);
  if (normalized) {
    variants.add(normalized);
  }

  buildAliasVariantMap();
  const aliasVariants = aliasVariantMap.get(normalized);
  if (aliasVariants) {
    aliasVariants.forEach((variant) => variants.add(variant));
  }

  const result = Array.from(variants).filter(Boolean);
  variantsCache.set(cacheKey, result);
  return result;
}

function computeVariantSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
  const cachedFinal = variantSimilarityCache.get(key);
  if (cachedFinal !== undefined) {
    return cachedFinal;
  }

  if (a === b) {
    const perfect = 1;
    levenshteinCache.set(key, perfect);
    jaccardCache.set(key, perfect);
    variantSimilarityCache.set(key, perfect);
    return perfect;
  }

  let maxScore = 0;

  if (a.includes(b) || b.includes(a)) {
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    const containScore = 0.85 + (shorter.length / longer.length) * 0.15;
    maxScore = Math.max(maxScore, containScore);
  }

  const jaccardScore = jaccardSimilarity(a, b);
  maxScore = Math.max(maxScore, jaccardScore);

  const levenScore = levenshteinSimilarity(a, b);
  maxScore = Math.max(maxScore, levenScore);

  variantSimilarityCache.set(key, maxScore);
  return maxScore;
}

/**
 * Jaccard 相似度（基于 3-gram）
 */
function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
  const cached = jaccardCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const getTokens = (value: string): string[] => {
    const tokenCached = ngramCache.get(value);
    if (tokenCached) {
      return tokenCached;
    }
    const tokens = value.match(/.{1,3}/g) || [];
    ngramCache.set(value, tokens);
    return tokens;
  };

  const tokensA = new Set(getTokens(a));
  const tokensB = new Set(getTokens(b));

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  const score = union === 0 ? 0 : intersection / union;
  jaccardCache.set(key, score);
  return score;
}

/**
 * Levenshtein 距离相似度
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
  const cached = levenshteinCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const maxLen = Math.max(a.length, b.length);
  const score = maxLen === 0 ? 1 : 1 - matrix[b.length][a.length] / maxLen;
  levenshteinCache.set(key, score);
  return score;
}

/**
 * 综合相似度计算
 */
function calculateSimilarity(name1: string, ...otherNames: Array<string | null | undefined>): number {
  const variants1 = getTeamVariants(name1);
  const variants2Set = new Set<string>();

  for (const name of otherNames) {
    if (!name) continue;
    const normalized = name.trim();
    if (!normalized) continue;
    for (const variant of getTeamVariants(normalized)) {
      variants2Set.add(variant);
    }
  }

  const variants2 = Array.from(variants2Set);
  if (variants2.length === 0) {
    return 0;
  }
  
  let maxScore = 0;
  
  for (const v1 of variants1) {
    for (const v2 of variants2) {
      if (!v1 || !v2) continue;
      const score = computeVariantSimilarity(v1, v2);
      if (score >= 1) {
        return 1;
      }
      maxScore = Math.max(maxScore, score);
    }
  }
  
  return maxScore;
}

function loadCrownMatches(file: string): CrownMatchFile {
  if (!fs.existsSync(file)) {
    throw new Error(`未找到 crown-gids 文件: ${file}`);
  }
  const content = fs.readFileSync(file, 'utf-8');
  const data = JSON.parse(content);

  // 过滤掉特殊盘口
  if (data.matches) {
    data.matches = data.matches.filter((m: CrownMatch) => {
      const isSpecial = (m.home === 'Home Team' && m.away === 'Away Team') ||
                       m.league.includes('Specials') ||
                       m.league.includes('Special');
      return !isSpecial;
    });
  }

  return data;
}

async function fetchISportsSchedule(apiKey: string, date: string): Promise<ISportsMatch[]> {
  const url = `${ISPORTS_API_BASE}/schedule/basic`;
  const response = await axios.get(url, {
    params: { api_key: apiKey, date },
    timeout: 30000,
  });

  if (response.data.code !== 0) {
    throw new Error(`iSports Schedule 接口返回错误: ${JSON.stringify(response.data)}`);
  }

  return (response.data.data || []).map((item: any) => ({
    matchId: String(item.matchId),
    leagueName: String(item.leagueName || ''),
    leagueId: String(item.leagueId || ''),
    matchTime: Number(item.matchTime) * 1000,
    status: Number(item.status),
    homeId: String(item.homeId || ''),
    homeName: String(item.homeName || ''),
    awayId: String(item.awayId || ''),
    awayName: String(item.awayName || ''),
    raw: item,
  }));
}

function parseCrownDate(datetime: string, generatedAt: string): Date | null {
  if (!datetime) return null;

  try {
    const match = datetime.match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})([ap])/i);
    if (!match) return null;

    const [, month, day, hour12, minute, ampm] = match;
    let hour = parseInt(hour12, 10);
    if (ampm.toLowerCase() === 'p' && hour !== 12) hour += 12;
    if (ampm.toLowerCase() === 'a' && hour === 12) hour = 0;

    const refDate = parseISO(generatedAt);
    const year = refDate.getFullYear();
    const result = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10), hour, parseInt(minute, 10));

    return result;
  } catch {
    return null;
  }
}

async function main() {
  const crownFilePath = process.env.CROWN_GID_INPUT || DEFAULT_CROWN_FILE;
  const outputPath = process.env.CROWN_MAP_OUTPUT || DEFAULT_OUTPUT;
  const apiKey = process.env.ISPORTS_API_KEY || process.env.ISPORTS_APIKEY || process.env.ISPORTS_KEY;
  const minScore = parseFloat(process.env.CROWN_MAP_MIN_SCORE || '0.48');

  if (!apiKey) {
    console.error('❌ 请在环境变量中设置 ISPORTS_API_KEY');
    process.exit(1);
  }

  const totalStartTime = Date.now();

  console.log(`🔧 配置:`);
  console.log(`  皇冠文件: ${crownFilePath}`);
  console.log(`  输出文件: ${outputPath}`);
  console.log(`  最小相似度: ${minScore}`);
  console.log('');

  const crownData = loadCrownMatches(crownFilePath);
  console.log(`📥 加载皇冠赛事: ${crownData.matches.length} 场`);

  const crownContext: MatchContext[] = crownData.matches.map(m => ({
    crown: m,
    crownDate: parseCrownDate(m.datetime, crownData.generatedAt),
  }));

  // 获取 iSports 赛事（昨天、今天、明天）
  const today = new Date();
  const pastDays = Number(process.env.CROWN_MAP_FETCH_PAST_DAYS || '1');
  const futureDays = Number(process.env.CROWN_MAP_FETCH_FUTURE_DAYS || '5');
  const datesToFetch: string[] = [];

  for (let offset = -pastDays; offset <= futureDays; offset++) {
    const date = addDays(today, offset).toISOString().split('T')[0];
    if (!datesToFetch.includes(date)) {
      datesToFetch.push(date);
    }
  }

  console.log('📥 获取 iSports 赛事（并行）...');
  const fetchStartTime = Date.now();
  const isportsMatches: ISportsMatch[] = [];

  // 并行获取所有日期的数据
  const fetchPromises = datesToFetch.map(async (date) => {
    try {
      console.log(`  ${date}...`);
      const matches = await fetchISportsSchedule(apiKey, date);
      console.log(`    ✅ ${date}: ${matches.length} 场`);
      return matches;
    } catch (error: any) {
      console.error(`  ❌ ${date}: ${error.message}`);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  results.forEach(matches => isportsMatches.push(...matches));

  const fetchTime = ((Date.now() - fetchStartTime) / 1000).toFixed(1);
  console.log(`✅ 总共获取 ${isportsMatches.length} 场 iSports 赛事 (用时: ${fetchTime}s)`);
  console.log('');

  const cacheDir = path.resolve(process.cwd(), '../fetcher-isports/data');
  const languageService = getLanguageService(apiKey, cacheDir);

  console.log('🌐 加载语言包...');
  const langStartTime = Date.now();
  await languageService.ensureCache();
  const langTime = ((Date.now() - langStartTime) / 1000).toFixed(1);
  console.log(`✅ 语言包加载完成 (用时: ${langTime}s)`);

  const converter = Converter({ from: 'tw', to: 'cn' });

  console.log('🔄 添加中文翻译...');
  const translateStartTime = Date.now();
  const matchesForMapping: ISportsMatchExtended[] = isportsMatches.map((match) => {
    const leagueNameTc = match.leagueId ? languageService.getLeagueName(match.leagueId) : null;
    const leagueNameCn = leagueNameTc ? converter(leagueNameTc) : null;
    const homeNameTc = match.homeId ? languageService.getTeamName(match.homeId) : null;
    const homeNameCn = match.homeId
      ? languageService.getTeamNameSimplified(match.homeId) || (homeNameTc ? converter(homeNameTc) : null)
      : null;
    const awayNameTc = match.awayId ? languageService.getTeamName(match.awayId) : null;
    const awayNameCn = match.awayId
      ? languageService.getTeamNameSimplified(match.awayId) || (awayNameTc ? converter(awayNameTc) : null)
      : null;

    return {
      ...match,
      leagueNameTc,
      leagueNameCn,
      homeNameTc,
      homeNameCn,
      awayNameTc,
      awayNameCn,
    };
  });

  const translateTime = ((Date.now() - translateStartTime) / 1000).toFixed(1);
  console.log(`✅ 翻译完成 (用时: ${translateTime}s)`);
  console.log('');

  if (!matchesForMapping.length) {
    console.error('❌ 未获取到任何 iSports 赛事，无法建立映射');
    process.exit(1);
  }

  const bucketMap = new Map<string, ISportsMatchExtended[]>();
  const pushToBucket = (key: string, match: ISportsMatchExtended) => {
    if (!bucketMap.has(key)) {
      bucketMap.set(key, []);
    }
    bucketMap.get(key)!.push(match);
  };

  const dayKey = (time: number) => {
    const date = new Date(time);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  };

  matchesForMapping.forEach((match) => {
    const key = dayKey(match.matchTime);
    pushToBucket(key, match);
  });

  const getCandidateMatches = (crownDate: Date | null): ISportsMatchExtended[] => {
    if (!crownDate) {
      return matchesForMapping;
    }
    const base = new Date(crownDate);
    base.setUTCHours(0, 0, 0, 0);
    const keys = [0, -1, 1].map((offset) => {
      const date = addDays(base, offset);
      return date.toISOString();
    });
    const candidates: ISportsMatchExtended[] = [];
    for (const key of keys) {
      const list = bucketMap.get(key);
      if (list) {
        candidates.push(...list);
      }
    }
    return candidates.length ? candidates : matchesForMapping;
  };

  // 正向匹配：从皇冠赛事出发，在 iSports 中查找最佳匹配
  // 这样只需要遍历 601 场皇冠赛事，而不是 3214 场 iSports 赛事
  console.log('🔄 开始匹配（从皇冠 → iSports）...');
  const startTime = Date.now();
  const matchedEntries: MappingEntry[] = [];
  const unmatchedCrown: MatchContext[] = [];
  const usedIsportsIds = new Set<string>();

  let processedCount = 0;
  const totalCount = crownContext.length;

  for (const ctx of crownContext) {
    processedCount++;
    if (processedCount % 10 === 0 || processedCount === 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const speed = (processedCount / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`  进度: ${processedCount}/${totalCount} (${(processedCount / totalCount * 100).toFixed(1)}%) - 用时: ${elapsed}s - 速度: ${speed} 场/秒`);
    }

    const crownMatch = ctx.crown;
    const crownDate = ctx.crownDate;

    let best: { isMatch: ISportsMatchExtended; score: number; timeDiff: number } | null = null;

    const candidateMatches = getCandidateMatches(crownDate);

    for (const isMatch of candidateMatches) {
      if (usedIsportsIds.has(isMatch.matchId)) continue;

      const timeDiffMinutes = crownDate
        ? Math.abs(differenceInMinutes(new Date(isMatch.matchTime), crownDate))
        : 720;

      const timeScore = crownDate ? Math.max(0, 1 - timeDiffMinutes / 240) : 0.2;

      const leagueScore = calculateSimilarity(
        crownMatch.league,
        isMatch.leagueName,
        isMatch.leagueNameTc || undefined,
        isMatch.leagueNameCn || undefined
      );

      const homeScore = calculateSimilarity(
        crownMatch.home,
        isMatch.homeName,
        isMatch.homeNameTc || undefined,
        isMatch.homeNameCn || undefined
      );
      const awayScore = calculateSimilarity(
        crownMatch.away,
        isMatch.awayName,
        isMatch.awayNameTc || undefined,
        isMatch.awayNameCn || undefined
      );

      const combined =
        timeScore * 0.15 +
        leagueScore * 0.15 +
        homeScore * 0.35 +
        awayScore * 0.35;

      if (!best || combined > best.score) {
        best = { isMatch, score: combined, timeDiff: timeDiffMinutes };
      }
    }

    if (best && best.score >= minScore) {
      usedIsportsIds.add(best.isMatch.matchId);
      matchedEntries.push({
        isports_match_id: best.isMatch.matchId,
        crown_gid: crownMatch.crown_gid,
        similarity: Number(best.score.toFixed(3)),
        time_diff_minutes: best.timeDiff,
        crown: {
          league: crownMatch.league,
          home: crownMatch.home,
          away: crownMatch.away,
          datetime: crownMatch.datetime,
          source_showtype: crownMatch.source_showtype,
        },
        isports: {
          league: best.isMatch.leagueName,
          league_tc: best.isMatch.leagueNameTc || undefined,
          league_cn: best.isMatch.leagueNameCn || undefined,
          home: best.isMatch.homeName,
          home_tc: best.isMatch.homeNameTc || undefined,
          home_cn: best.isMatch.homeNameCn || undefined,
          away: best.isMatch.awayName,
          away_tc: best.isMatch.awayNameTc || undefined,
          away_cn: best.isMatch.awayNameCn || undefined,
          match_time: new Date(best.isMatch.matchTime).toISOString(),
        },
      });
    } else {
      unmatchedCrown.push(ctx);
    }
  }

  const matchTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const avgSpeed = (totalCount / (Date.now() - startTime) * 1000).toFixed(1);
  console.log(`✅ 匹配完成: ${processedCount}/${totalCount} - 用时: ${matchTime}s - 平均速度: ${avgSpeed} 场/秒`);

  matchedEntries.sort((a, b) => b.similarity - a.similarity);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const mappingOutput = {
    generatedAt: new Date().toISOString(),
    crownGeneratedAt: crownData.generatedAt,
    crownMatchCount: crownContext.length,
    isportsMatchCount: isportsMatches.length,
    matchedCount: matchedEntries.length,
    unmatchedCount: unmatchedCrown.length,
    matches: matchedEntries,
    unmatched: unmatchedCrown.slice(0, 50).map((ctx) => ({
      crown_gid: ctx.crown.crown_gid,
      league: ctx.crown.league,
      home: ctx.crown.home,
      away: ctx.crown.away,
      datetime: ctx.crown.datetime,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(mappingOutput, null, 2), 'utf-8');

  const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
  console.log(`\n✅ 映射完成，匹配成功 ${matchedEntries.length}/${crownContext.length} 场 (${(matchedEntries.length / crownContext.length * 100).toFixed(1)}%)`);
  console.log(`💾 映射文件已保存到 ${outputPath}`);
  console.log(`⏱️  总用时: ${totalTime}s`);
  if (unmatchedCrown.length) {
    console.log(`⚠️  尚有 ${unmatchedCrown.length} 场未匹配，可在文件 unmatched 字段查看前 50 条`);
  }
}

main().catch((error) => {
  console.error('❌ 构建映射失败:', error);
  process.exit(1);
});
