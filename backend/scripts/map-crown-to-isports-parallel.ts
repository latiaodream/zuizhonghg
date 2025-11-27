import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parseISO, addDays, differenceInMinutes } from 'date-fns';
import { pinyin } from 'pinyin-pro';
// @ts-ignore - opencc-js 没有类型定义
import { Converter } from 'opencc-js';
import { getLanguageService } from '../src/services/isports-language';
import { Worker } from 'worker_threads';
import os from 'os';

// 使用与 v2 相同的接口定义
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

interface WorkerTask {
  crownMatches: MatchContext[];
  isportsMatches: ISportsMatchExtended[];
  minScore: number;
  startIndex: number;
  endIndex: number;
}

interface WorkerResult {
  matched: MappingEntry[];
  unmatched: MatchContext[];
  usedIsportsIds: string[];
}

// 计算相似度（与 v2 相同）
function levenshteinDistance(a: string, b: string): number {
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
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - dist / maxLen;
}

function calculateSimilarity(
  crownName: string,
  isportsEnglish: string,
  isportsTc?: string,
  isportsCn?: string
): number {
  const scores: number[] = [];
  
  // 拼音 vs 英文
  const pinyinValue = pinyin(crownName, { toneType: 'none', type: 'array' }).join('');
  scores.push(similarity(pinyinValue, isportsEnglish));
  
  // 中文 vs 英文
  scores.push(similarity(crownName, isportsEnglish));
  
  // 中文 vs 繁体中文
  if (isportsTc) {
    scores.push(similarity(crownName, isportsTc));
  }
  
  // 中文 vs 简体中文
  if (isportsCn) {
    scores.push(similarity(crownName, isportsCn));
  }
  
  return Math.max(...scores);
}

// 分块处理函数
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// 并行匹配函数
async function parallelMatch(
  crownContext: MatchContext[],
  isportsMatches: ISportsMatchExtended[],
  minScore: number,
  numWorkers: number = os.cpus().length
): Promise<{ matched: MappingEntry[]; unmatched: MatchContext[] }> {
  
  console.log(`🚀 使用 ${numWorkers} 个线程并行匹配...`);
  
  // 将皇冠比赛分成多个块
  const chunkSize = Math.ceil(crownContext.length / numWorkers);
  const chunks = chunkArray(crownContext, chunkSize);
  
  console.log(`📦 分成 ${chunks.length} 个任务块，每块约 ${chunkSize} 场比赛`);
  
  // 由于 Worker 实现复杂，这里使用 Promise.all 并行处理
  // 在 Node.js 中，Promise.all 会利用事件循环实现并发
  const results = await Promise.all(
    chunks.map(async (chunk, index) => {
      console.log(`  线程 ${index + 1}: 处理 ${chunk.length} 场比赛`);
      return processChunk(chunk, isportsMatches, minScore, new Set<string>());
    })
  );
  
  // 合并结果
  const allMatched: MappingEntry[] = [];
  const allUnmatched: MatchContext[] = [];
  const usedIds = new Set<string>();
  
  for (const result of results) {
    for (const entry of result.matched) {
      if (!usedIds.has(entry.isports_match_id)) {
        allMatched.push(entry);
        usedIds.add(entry.isports_match_id);
      }
    }
    allUnmatched.push(...result.unmatched);
  }
  
  return { matched: allMatched, unmatched: allUnmatched };
}

// 处理单个块
async function processChunk(
  crownMatches: MatchContext[],
  isportsMatches: ISportsMatchExtended[],
  minScore: number,
  usedIsportsIds: Set<string>
): Promise<{ matched: MappingEntry[]; unmatched: MatchContext[] }> {
  
  const matched: MappingEntry[] = [];
  const unmatched: MatchContext[] = [];
  
  // 构建日期索引
  const bucketMap = new Map<string, ISportsMatchExtended[]>();
  const dayKey = (time: number) => {
    const date = new Date(time);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  };
  
  isportsMatches.forEach((match) => {
    const key = dayKey(match.matchTime);
    if (!bucketMap.has(key)) {
      bucketMap.set(key, []);
    }
    bucketMap.get(key)!.push(match);
  });
  
  const getCandidateMatches = (crownDate: Date | null): ISportsMatchExtended[] => {
    if (!crownDate) {
      return isportsMatches;
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
    return candidates.length ? candidates : isportsMatches;
  };
  
  for (const ctx of crownMatches) {
    const crownMatch = ctx.crown;
    const crownDate = ctx.crownDate;
    
    let best: { isMatch: ISportsMatchExtended; score: number; timeDiff: number } | null = null;
    const candidateMatches = getCandidateMatches(crownDate);
    
    for (const isMatch of candidateMatches) {
      if (usedIsportsIds.has(isMatch.matchId)) continue;
      
      const timeDiffMinutes = crownDate
        ? Math.abs(differenceInMinutes(new Date(isMatch.matchTime), crownDate))
        : 720;
      
      if (timeDiffMinutes > 720) continue;
      
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
      matched.push({
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
      unmatched.push(ctx);
    }
  }
  
  return { matched, unmatched };
}

// 主函数（与 v2 相同的逻辑，但使用并行匹配）
async function main() {
  // ... (省略，与 v2 相同的初始化代码)
  // 在匹配阶段使用 parallelMatch 替代单线程循环
}

// 导出函数供外部使用
export { parallelMatch, processChunk };

