import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { nameAliasService } from '../src/services/name-alias-service';
import { pool } from '../src/models/database';

interface CrownMatch {
  league?: string;
  league_name?: string;
  leagueName?: string;
  leagueNameZhTw?: string;
  leagueNameEn?: string;
  home?: string;
  home_team?: string;
  homeName?: string;
  away?: string;
  away_team?: string;
  awayName?: string;
  match_time?: string;
  time?: string;
  timer?: string;
  matchTime?: string | number;
  showtype?: string;
  showType?: string;
}

const now = new Date();
const todayDate = now.toISOString().slice(0, 10);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};
  args.forEach((arg) => {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
      const optionKey = key.slice(2);
      options[optionKey] = value !== undefined ? value : true;
    }
  });
  return options;
};

const options = parseArgs();
const mode = (options.mode as string)?.toLowerCase() || 'today';
const customDate = typeof options.date === 'string' ? options.date : undefined;
const effectiveDate = customDate || todayDate;

const candidateFiles = [
  typeof options.file === 'string' ? options.file : null,
  path.join(__dirname, '../../fetcher/data/latest-matches.json'),
  path.join(__dirname, '../../fetcher-isports/data/latest-matches.json'),
].filter((file): file is string => !!file);

const parseTimestamp = (match: CrownMatch): number | null => {
  const raw = match.matchTime ?? match.match_time ?? match.time ?? match.timer;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    if (raw > 1e12) return raw;
    if (raw > 1e9) return raw * 1000;
    return raw;
  }
  const str = String(raw).trim();
  if (!str) return null;

  const tryParse = (value: string): number | null => {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
    return null;
  };

  let parsed = tryParse(str);
  if (parsed !== null) return parsed;

  parsed = tryParse(str.replace(/-/g, '/'));
  if (parsed !== null) return parsed;

  const currentYear = new Date().getFullYear();
  parsed = tryParse(`${currentYear}-${str}`.replace(/-/g, '/'));
  if (parsed !== null) return parsed;

  return null;
};

const loadMatches = async (): Promise<CrownMatch[]> => {
  for (const file of candidateFiles) {
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      const data = JSON.parse(raw);
      const matches = data.matches || [];
      console.log(`✅ 从 ${file} 读取到 ${matches.length} 场比赛`);
      return matches as CrownMatch[];
    } catch (error) {
      console.error(`❌ 解析 ${file} 失败:`, error);
    }
  }
  console.warn('⚠️ 未找到本地抓取数据文件');
  return [];
};

const filterMatches = (matches: CrownMatch[]): CrownMatch[] => {
  if (mode === 'all') {
    console.log('ℹ️ 模式: all，返回全部比赛');
    return matches;
  }

  const filtered = matches.filter((match) => {
    const showtype = (match.showtype || match.showType || '').toLowerCase();
    if (showtype) {
      return showtype === 'today';
    }
    const ts = parseTimestamp(match);
    if (!ts) return false;
    const matchDate = new Date(ts).toISOString().slice(0, 10);
    return matchDate === effectiveDate;
  });

  if (filtered.length === 0 && mode === 'today') {
    console.warn('⚠️ 今日筛选结果为空，自动回退到全部比赛');
    return matches;
  }

  return filtered;
};

const extractLeagueName = (match: CrownMatch): string | null => {
  return (
    match.league?.trim() ||
    match.league_name?.trim() ||
    match.leagueName?.trim() ||
    null
  );
};

const extractTeamNames = (match: CrownMatch): string[] => {
  const set = new Set<string>();
  [
    match.home,
    match.home_team,
    match.homeName,
    match.away,
    match.away_team,
    match.awayName,
  ].forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  });
  return Array.from(set);
};

const upsertLeague = async (name: string) => {
  const canonical = nameAliasService.normalizeKey('league', name);
  if (!canonical || canonical.endsWith(':unknown')) {
    return;
  }
  const existing = await nameAliasService.getLeagueByCanonical(canonical);
  const aliasSet = new Set<string>();
  aliasSet.add(name.trim());
  if (existing) {
    existing.aliases.forEach((alias) => aliasSet.add(alias));
    await nameAliasService.updateLeagueAlias(existing.id, {
      canonicalKey: canonical,
      nameZhCn: existing.name_zh_cn || name,
      nameZhTw: existing.name_zh_tw,
      nameEn: existing.name_en,
      aliases: Array.from(aliasSet),
    });
  } else {
    await nameAliasService.createLeagueAlias({
      canonicalKey: canonical,
      nameZhCn: name,
      aliases: Array.from(aliasSet),
    });
  }
};

const upsertTeam = async (name: string) => {
  const canonical = nameAliasService.normalizeKey('team', name);
  if (!canonical || canonical.endsWith(':unknown')) {
    return;
  }
  const existing = await nameAliasService.getTeamByCanonical(canonical);
  const aliasSet = new Set<string>();
  aliasSet.add(name.trim());
  if (existing) {
    existing.aliases.forEach((alias) => aliasSet.add(alias));
    await nameAliasService.updateTeamAlias(existing.id, {
      canonicalKey: canonical,
      nameZhCn: existing.name_zh_cn || name,
      nameZhTw: existing.name_zh_tw,
      nameEn: existing.name_en,
      aliases: Array.from(aliasSet),
    });
  } else {
    await nameAliasService.createTeamAlias({
      canonicalKey: canonical,
      nameZhCn: name,
      aliases: Array.from(aliasSet),
    });
  }
};

const run = async () => {
  try {
    const allMatches = await loadMatches();
    if (!allMatches.length) {
      console.warn('⚠️ 没有可用的比赛数据，任务结束');
      return;
    }

    const todayMatches = filterMatches(allMatches);
    console.log(`📅 选中比赛共 ${todayMatches.length} 场 (模式: ${mode}, 日期: ${effectiveDate})`);

    const leagueNames = new Set<string>();
    const teamNames = new Set<string>();

    todayMatches.forEach((match) => {
      const league = extractLeagueName(match);
      if (league) {
        leagueNames.add(league.trim());
      }
      const teams = extractTeamNames(match);
      teams.forEach((team) => {
        if (team) teamNames.add(team.trim());
      });
    });

    console.log(`🏆 联赛名称：${leagueNames.size} 条`);
    console.log(`👥 球队名称：${teamNames.size} 条`);

    let leagueSuccess = 0;
    for (const name of leagueNames) {
      try {
        await upsertLeague(name);
        leagueSuccess += 1;
      } catch (error) {
        console.error(`❌ 联赛 "${name}" 写入失败:`, error);
      }
    }

    let teamSuccess = 0;
    for (const name of teamNames) {
      try {
        await upsertTeam(name);
        teamSuccess += 1;
      } catch (error) {
        console.error(`❌ 球队 "${name}" 写入失败:`, error);
      }
    }

    console.log(`✅ 联赛写入完成: ${leagueSuccess}/${leagueNames.size}`);
    console.log(`✅ 球队写入完成: ${teamSuccess}/${teamNames.size}`);
  } finally {
    await pool.end().catch(() => undefined);
  }
};

run().then(() => {
  console.log('🎉 任务完成');
  process.exit(0);
}).catch((error) => {
  console.error('❌ 任务失败:', error);
  process.exit(1);
});
