import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parseISO, addDays, differenceInMinutes } from 'date-fns';
import { pinyin } from 'pinyin-pro';

interface CrownMatchFile {
  generatedAt: string;
  matches: CrownMatch[];
}

interface CrownMatch {
  crown_gid: string;
  league: string;
  league_id: string;
  home: string;
  away: string;
  datetime: string;
  raw: any;
  source_showtype: string;
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
    source_showtype: string;
  };
  isports: {
    league: string;
    home: string;
    away: string;
    match_time: string;
  };
}

// 常见球队别名映射
const TEAM_ALIASES: Record<string, string[]> = {
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
};

// 需要移除的无效词
const REMOVE_WORDS = [
  'fc', 'cf', 'sc', 'ac', 'as', 'cd', 'rcd', 'ud', 'sd',
  'u23', 'u21', 'u19', 'u18',
  'football club', 'soccer club', 'sporting club',
  'club', 'united', 'city', 'town', 'athletic',
  'reserves', 'ii', 'iii', 'b', 'c',
];

const DEFAULT_CROWN_FILE = path.resolve(process.cwd(), 'crown-gids.json');
const DEFAULT_OUTPUT = path.resolve(process.cwd(), '../fetcher-isports/data/crown-match-map.json');
const ISPORTS_API_BASE = 'http://api.isportsapi.com/sport/football';

/**
 * 标准化球队/联赛名称
 * 1. 转小写
 * 2. 中文转拼音
 * 3. 移除无效词
 * 4. 只保留字母和数字
 */
function normalizeTeamName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // 检查是否包含中文字符
  const hasChinese = /[\u4e00-\u9fa5]/.test(normalized);
  if (hasChinese) {
    // 转换为拼音（不带音调，空格分隔）
    normalized = pinyin(normalized, { toneType: 'none', type: 'array' }).join('');
  }

  // 移除无效词
  for (const word of REMOVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    normalized = normalized.replace(regex, ' ');
  }

  // 只保留字母和数字
  normalized = normalized.replace(/[^a-z0-9]/g, '');

  return normalized;
}

/**
 * 获取球队的所有可能名称（包括别名）
 */
function getTeamVariants(name: string): string[] {
  const normalized = normalizeTeamName(name);
  const variants = [normalized];

  // 检查别名映射
  for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
    const canonicalNorm = normalizeTeamName(canonical);
    if (normalized === canonicalNorm) {
      variants.push(...aliases.map(a => normalizeTeamName(a)));
    }
    for (const alias of aliases) {
      const aliasNorm = normalizeTeamName(alias);
      if (normalized === aliasNorm) {
        variants.push(canonicalNorm);
        variants.push(...aliases.filter(a => a !== alias).map(a => normalizeTeamName(a)));
      }
    }
  }

  return [...new Set(variants)];
}

/**
 * Jaccard 相似度（基于 3-gram）
 */
function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokensA = new Set(a.match(/.{1,3}/g) || []); // 3-gram
  const tokensB = new Set(b.match(/.{1,3}/g) || []);

  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Levenshtein 距离相似度
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

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
  return maxLen === 0 ? 1 : 1 - matrix[b.length][a.length] / maxLen;
}

/**
 * 综合相似度计算
 * 使用 Jaccard + Levenshtein 的最大值
 */
function calculateSimilarity(name1: string, name2: string): number {
  const variants1 = getTeamVariants(name1);
  const variants2 = getTeamVariants(name2);

  let maxScore = 0;

  for (const v1 of variants1) {
    for (const v2 of variants2) {
      if (!v1 || !v2) continue;

      // 完全匹配
      if (v1 === v2) return 1.0;

      // 包含匹配
      if (v1.includes(v2) || v2.includes(v1)) {
        const shorter = v1.length < v2.length ? v1 : v2;
        const longer = v1.length < v2.length ? v2 : v1;
        const containScore = 0.85 + (shorter.length / longer.length) * 0.15;
        maxScore = Math.max(maxScore, containScore);
      }

      // Jaccard 相似度
      const jaccardScore = jaccardSimilarity(v1, v2);
      maxScore = Math.max(maxScore, jaccardScore);

      // Levenshtein 相似度
      const levenScore = levenshteinSimilarity(v1, v2);
      maxScore = Math.max(maxScore, levenScore);
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

  // 过滤掉特殊盘口（Home Team vs Away Team）
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

async function fetchISportsSchedule(
  apiKey: string,
  date: string
): Promise<ISportsMatch[]> {
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
    matchTime: Number(item.matchTime) * 1000, // convert to ms
    status: Number(item.status),
    homeId: String(item.homeId || ''),
    homeName: String(item.homeName || ''),
    awayId: String(item.awayId || ''),
    awayName: String(item.awayName || ''),
    raw: item,
  }));
}

const STOP_WORDS = new Set([
  'fc', 'sc', 'ac', 'cf', 'club', 'team', 'afc', 'u19', 'u21', 'u20', 'u23', 'women',
  'ladies', 'reserves', 'reserve', 'b', 'ii', 'iii', 'the'
]);

const MANUAL_ALIASES: Record<string, string> = {
  'psv eindhoven': 'psv',
  'sporting lisbon': 'sporting cp',
  'monchengladbach': 'borussia monchengladbach',
  'hertha berlin': 'hertha bsc',
  'bayern munchen': 'bayern munich',
  'shijiazhuang kungfu': 'shijiazhuang gongfu',
  'new york city': 'nycfc',
  'new york red bulls': 'ny red bulls',
  'la galaxy': 'los angeles galaxy',
};

const MIN_SCORE = Number(process.env.CROWN_MAP_MIN_SCORE ?? '0.48');
const TIME_WINDOW_MINUTES = Number(process.env.CROWN_MAP_TIME_WINDOW_MIN ?? '480'); // 8 小时

const normalize = (str: string): string =>
  str
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getTokens = (raw: string): string[] =>
  normalize(raw)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token));

const expandNameVariants = (name: string, extra?: string): string[] => {
  const variants = new Set<string>();
  const normalized = normalize(name);
  variants.add(normalized);

  if (extra) {
    variants.add(normalize(extra));
  }

  const alias = MANUAL_ALIASES[normalized];
  if (alias) {
    variants.add(alias);
  }

  // 添加拼音（处理中文情况）
  const hasChinese = /[\u4e00-\u9fff]/.test(name);
  if (hasChinese) {
    variants.add(
      normalize(
        pinyin(name, {
          toneType: 'none',
          type: 'array',
        }).join(' ')
      )
    );
  }

  return Array.from(variants).filter(Boolean);
};

const jaccardSimilarity = (tokensA: string[], tokensB: string[]): number => {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size || 1;
  return intersection / union;
};

const levenshtein = (a: string, b: string): number => {
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;

  const matrix: number[][] = Array.from({ length: alen + 1 }, () => Array(blen + 1).fill(0));
  for (let i = 0; i <= alen; i++) matrix[i][0] = i;
  for (let j = 0; j <= blen; j++) matrix[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[alen][blen];
};

const stringSimilarity = (a: string, b: string): number => {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;

  // 如果包含关系，直接给高分
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return 0.75 + (shorter / longer) * 0.25;
  }

  const distance = levenshtein(na, nb);
  const longerLen = Math.max(na.length, nb.length) || 1;
  return (longerLen - distance) / longerLen;
};

const nameSimilarity = (crownName: string, isportsName?: string, isportsAlternative?: string): number => {
  if (!isportsName && !isportsAlternative) return 0;
  const crownVariants = expandNameVariants(crownName);
  const isportsVariants = expandNameVariants(isportsName || isportsAlternative || '', isportsAlternative);

  let bestScore = 0;
  for (const crownVariant of crownVariants) {
    const crownTokens = getTokens(crownVariant);
    for (const isVariant of isportsVariants) {
      const isTokens = getTokens(isVariant);
      const tokenScore = jaccardSimilarity(crownTokens, isTokens);
      const strScore = stringSimilarity(crownVariant, isVariant);
      const score = tokenScore * 0.55 + strScore * 0.45;
      if (score > bestScore) bestScore = score;
    }
  }
  return bestScore;
};



function parseCrownDate(datetimeStr: string, reference: Date): Date | null {
  if (!datetimeStr) return null;
  const match = datetimeStr.match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})([ap])/i);
  if (!match) return null;
  const [, monthStr, dayStr, hourStr, minuteStr, ap] = match;
  let month = Number(monthStr) - 1;
  let day = Number(dayStr);
  let hour = Number(hourStr);
  const minute = Number(minuteStr);
  const isPM = ap.toLowerCase() === 'p';

  if (isPM && hour < 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;

  const result = new Date(Date.UTC(reference.getUTCFullYear(), month, day, hour, minute));

  const diff = Math.abs(result.getTime() - reference.getTime());
  const sixMonthsMs = 1000 * 60 * 60 * 24 * 182;
  if (diff > sixMonthsMs) {
    const yearAdjustment = result < reference ? 1 : -1;
    result.setUTCFullYear(result.getUTCFullYear() + yearAdjustment);
  }

  return result;
}

interface MatchContext {
  crown: CrownMatch;
  crownDate: Date | null;
}

function buildMatchContext(crownFile: CrownMatchFile): MatchContext[] {
  const generatedAt = crownFile.generatedAt ? new Date(crownFile.generatedAt) : new Date();
  return crownFile.matches.map((m) => ({
    crown: m,
    crownDate: parseCrownDate(m.datetime, generatedAt),
  }));
}

async function main() {
  const crownFilePath = process.env.CROWN_GID_INPUT || DEFAULT_CROWN_FILE;
  const outputPath = process.env.CROWN_MAP_OUTPUT || DEFAULT_OUTPUT;
  const apiKey = process.env.ISPORTS_API_KEY || process.env.ISPORTS_APIKEY || process.env.ISPORTS_KEY;

  if (!apiKey) {
    console.error('❌ 请在环境变量中设置 ISPORTS_API_KEY');
    process.exit(1);
  }

  // 初始化语言包服务
  console.log('🌐 初始化语言包服务...');
  const languageService = new ISportsLanguageService(apiKey, path.join(__dirname, '..', '..', 'fetcher-isports', 'data'));
  await languageService.ensureCache();
  const stats = languageService.getCacheStats();
  console.log(`✅ 语言包已加载: ${stats.leagues} 联赛, ${stats.teams} 球队`);

  const crownData = loadCrownMatches(crownFilePath);
  const crownContext = buildMatchContext(crownData);

  if (!crownContext.length) {
    console.warn('⚠️ crown-gids 中没有赛事记录，结束');
    process.exit(0);
  }

  const referenceDate = crownData.generatedAt ? new Date(crownData.generatedAt) : new Date();
  const datesToFetch = new Set<string>();
  const baseDateISO = referenceDate.toISOString().slice(0, 10);
  datesToFetch.add(baseDateISO);
  datesToFetch.add(addDays(referenceDate, 1).toISOString().slice(0, 10));
  datesToFetch.add(addDays(referenceDate, -1).toISOString().slice(0, 10));

  const isportsMatches: ISportsMatch[] = [];
  for (const date of datesToFetch) {
    try {
      console.log(`📥 获取 iSports 赛事: ${date}`);
      const matches = await fetchISportsSchedule(apiKey, date, languageService);
      console.log(`   获取到 ${matches.length} 场`);
      isportsMatches.push(...matches);
    } catch (error: any) {
      console.error(`❌ 获取 iSports 赛事失败 (${date}):`, error.message || error);
    }
  }

  if (!isportsMatches.length) {
    console.error('❌ 未获取到任何 iSports 赛事，无法建立映射');
    process.exit(1);
  }

  // 反向匹配：从 iSports 赛事出发，在皇冠中查找最佳匹配
  // 这样可以确保每个 iSports 赛事只匹配一个皇冠 GID
  console.log('🔄 开始匹配（从 iSports → 皇冠）...');
  const matchedEntries: MappingEntry[] = [];
  const unmatchedCrown: MatchContext[] = [];
  const usedCrownGids = new Set<string>();

  for (const isMatch of isportsMatches) {
    let best: { ctx: MatchContext; score: number; timeDiff: number } | null = null;

    for (const ctx of crownContext) {
      // 跳过已经被匹配的皇冠赛事
      if (usedCrownGids.has(ctx.crown.crown_gid)) {
        continue;
      }

      const crownMatch = ctx.crown;
      const crownDate = ctx.crownDate;

      const timeDiffMinutes = crownDate
        ? Math.abs(differenceInMinutes(new Date(isMatch.matchTime), crownDate))
        : TIME_WINDOW_MINUTES;
      if (timeDiffMinutes > TIME_WINDOW_MINUTES) {
        continue;
      }

      const timeScore = 1 - Math.min(timeDiffMinutes, TIME_WINDOW_MINUTES) / TIME_WINDOW_MINUTES;
      const leagueScore = nameSimilarity(
        crownMatch.league,
        isMatch.leagueName,
        isMatch.leagueNameTc
      );
      const homeScore = nameSimilarity(
        crownMatch.home,
        isMatch.homeName,
        isMatch.homeNameTc
      );
      const awayScore = nameSimilarity(
        crownMatch.away,
        isMatch.awayName,
        isMatch.awayNameTc
      );

      const combined =
        timeScore * 0.1 +
        leagueScore * 0.2 +
        homeScore * 0.35 +
        awayScore * 0.35;

      if (!best || combined > best.score) {
        best = { ctx, score: combined, timeDiff: timeDiffMinutes };
      }
    }

    if (best && best.score >= MIN_SCORE) {
      usedCrownGids.add(best.ctx.crown.crown_gid);
      matchedEntries.push({
        isports_match_id: isMatch.matchId,
        crown_gid: best.ctx.crown.crown_gid,
        similarity: Number(best.score.toFixed(3)),
        time_diff_minutes: best.timeDiff,
        crown: {
          league: best.ctx.crown.league,
          home: best.ctx.crown.home,
          away: best.ctx.crown.away,
          datetime: best.ctx.crown.datetime,
          source_showtype: best.ctx.crown.source_showtype,
        },
        isports: {
          league: isMatch.leagueName,
          home: isMatch.homeName,
          away: isMatch.awayName,
          match_time: new Date(isMatch.matchTime).toISOString(),
        },
      });
    }
  }

  // 找出未匹配的皇冠赛事
  for (const ctx of crownContext) {
    if (!usedCrownGids.has(ctx.crown.crown_gid)) {
      unmatchedCrown.push(ctx);
    }
  }

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
  console.log(`\n✅ 映射完成，匹配成功 ${matchedEntries.length}/${crownContext.length} 场`);
  console.log(`💾 映射文件已保存到 ${outputPath}`);
  if (unmatchedCrown.length) {
    console.log(`⚠️  尚有 ${unmatchedCrown.length} 场未匹配，可在文件 unmatched 字段查看前 50 条`);
  }
}

main().catch((error) => {
  console.error('❌ 构建映射失败:', error);
  process.exit(1);
});
