import { ISportsClient } from './isports-client';
import { nameAliasService } from './name-alias-service';

type MergeOptions = {
  gtype?: string;
  date?: string; // YYYY-MM-DD
};

type CrownMatch = Record<string, any>;

type ResolvedMatch = {
  match: CrownMatch;
  leagueKey: string;
  homeKey: string;
  awayKey: string;
  timeKey: string;
  resolved: {
    leagueName: string;
    homeName: string;
    awayName: string;
  };
};

type OddsBundle = {
  handicap: any[];
  europe: any[];
  overUnder: any[];
  handicapHalf: any[];
  overUnderHalf: any[];
};

const normalizeLine = (value?: string | number | null): string => {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return str.replace(/\s+/g, '').replace(/^\+/, '');
};

const sanitizeOdds = (value?: string | number | null): string | null => {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    const str = String(value).trim();
    return str || null;
  }
  return numeric.toFixed(2);
};

const parseTimestamp = (raw?: string | number | null): number | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    if (raw > 1e12) return raw;
    if (raw > 1e9) return raw * 1000;
    return raw;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const ts = Date.parse(trimmed.replace(/-/g, '/'));
    return Number.isFinite(ts) ? ts : null;
  }
  if (/^\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(trimmed)) {
    const year = new Date().getFullYear();
    const composed = `${year}-${trimmed}`;
    const ts = Date.parse(composed.replace(/-/g, '/'));
    return Number.isFinite(ts) ? ts : null;
  }
  const ts = Date.parse(trimmed);
  return Number.isFinite(ts) ? ts : null;
};

const timeKeyFromTimestamp = (ts: number | null): string => {
  if (!ts || !Number.isFinite(ts)) return 'time:unknown';
  const date = new Date(ts);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}`;
};

const buildMatchKey = (leagueKey: string, homeKey: string, awayKey: string, timeKey: string): string => {
  return `${leagueKey}|${homeKey}|${awayKey}|${timeKey}`;
};

const resolveCrownMatch = async (match: CrownMatch): Promise<ResolvedMatch> => {
  const league = await nameAliasService.resolveLeague(match.league || match.league_name || '');
  const home = await nameAliasService.resolveTeam(match.home || match.home_team || match.team_h || '');
  const away = await nameAliasService.resolveTeam(match.away || match.away_team || match.team_c || '');
  const ts = parseTimestamp(match.match_time || match.time || match.timer);
  const timeKey = timeKeyFromTimestamp(ts);

  const resolved: ResolvedMatch = {
    match,
    leagueKey: league.canonicalKey,
    homeKey: home.canonicalKey,
    awayKey: away.canonicalKey,
    timeKey,
    resolved: {
      leagueName: league.displayName,
      homeName: home.displayName,
      awayName: away.displayName,
    },
  };

  match.league = league.displayName;
  match.home = home.displayName;
  match.away = away.displayName;
  match.league_name = league.displayName;
  match.home_team = home.displayName;
  match.away_team = away.displayName;
  if (league.meta?.zh_cn) match.league_name_cn = league.meta.zh_cn;
  if (league.meta?.zh_tw) match.league_name_tw = league.meta.zh_tw;
  if (home.meta?.zh_cn) match.home_team_cn = home.meta.zh_cn;
  if (home.meta?.zh_tw) match.home_team_tw = home.meta.zh_tw;
  if (away.meta?.zh_cn) match.away_team_cn = away.meta.zh_cn;
  if (away.meta?.zh_tw) match.away_team_tw = away.meta.zh_tw;

  return resolved;
};

const resolveIsportsMatch = async (item: any): Promise<{ key: string; raw: any; matchTime: number | null }> => {
  const league = await nameAliasService.resolveLeague(item.leagueName || item.league_name || '');
  const home = await nameAliasService.resolveTeam(item.homeName || item.home_name || '');
  const away = await nameAliasService.resolveTeam(item.awayName || item.away_name || '');
  const tsRaw = typeof item.matchTime === 'number' ? item.matchTime : Number(item.match_time);
  const ts = parseTimestamp(tsRaw || item.matchTime || item.match_time);
  const timeKey = timeKeyFromTimestamp(ts);
  const key = buildMatchKey(league.canonicalKey, home.canonicalKey, away.canonicalKey, timeKey);
  return { key, raw: item, matchTime: ts };
};

const attachMoneyline = (match: CrownMatch, odds: any | undefined) => {
  if (!odds) return;
  const moneyline = match.markets?.moneyline || match.markets?.moneyLine || {};
  const home = sanitizeOdds(odds.instantHome);
  const draw = sanitizeOdds(odds.instantDraw);
  const away = sanitizeOdds(odds.instantAway);

  const target = match.markets?.moneyline ? match.markets.moneyline : match.markets?.moneyLine;
  if (target) {
    if (home) target.home = home;
    if (draw) target.draw = draw;
    if (away) target.away = away;
  } else {
    match.markets = match.markets || {};
    match.markets.moneyline = {
      home: home ?? moneyline.home,
      draw: draw ?? moneyline.draw,
      away: away ?? moneyline.away,
    };
  }
};

const matchAndAssignLines = (
  crownLines: any[] | undefined,
  oddsLines: any[] | undefined,
  opts: {
    isHandicap: boolean;
  }
) => {
  if (!Array.isArray(crownLines) || !Array.isArray(oddsLines)) return;
  const used = new Set<number>();

  crownLines.forEach((line) => {
    const targetLine = normalizeLine(line.line ?? line.ratio ?? '');
    if (!targetLine) return;

    let matchedIndex = -1;
    for (let i = 0; i < oddsLines.length; i += 1) {
      if (used.has(i)) continue;
      const oddsLine = oddsLines[i];
      const oddsValue = opts.isHandicap ? oddsLine.instantHandicap : oddsLine.instantHandicap;
      const normalizedOddsLine = normalizeLine(oddsValue);
      if (!normalizedOddsLine) continue;
      if (normalizedOddsLine === targetLine) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex >= 0) {
      const entry = oddsLines[matchedIndex];
      used.add(matchedIndex);
      if (opts.isHandicap) {
        const home = sanitizeOdds(entry.instantHome);
        const away = sanitizeOdds(entry.instantAway);
        if (home) line.home = home;
        if (away) line.away = away;
      } else {
        const over = sanitizeOdds(entry.instantOver ?? entry.instantHome);
        const under = sanitizeOdds(entry.instantUnder ?? entry.instantAway);
        if (over) line.over = over;
        if (under) line.under = under;
      }
    }
  });
};

const applyOddsToMatch = (match: CrownMatch, odds: OddsBundle | null | undefined) => {
  if (!odds) return;
  match.markets = match.markets || {};
  match.markets.full = match.markets.full || {};
  match.markets.full.handicapLines = Array.isArray(match.markets.full.handicapLines)
    ? match.markets.full.handicapLines
    : match.markets.handicapLines || [];
  match.markets.full.overUnderLines = Array.isArray(match.markets.full.overUnderLines)
    ? match.markets.full.overUnderLines
    : match.markets.overUnderLines || match.markets.ouLines || [];

  match.markets.half = match.markets.half || {};
  match.markets.half.handicapLines = Array.isArray(match.markets.half.handicapLines)
    ? match.markets.half.handicapLines
    : match.markets.halfHandicapLines || [];
  match.markets.half.overUnderLines = Array.isArray(match.markets.half.overUnderLines)
    ? match.markets.half.overUnderLines
    : match.markets.halfOverUnderLines || [];

  if (Array.isArray(match.markets.full.handicapLines) && odds.handicap?.length) {
    matchAndAssignLines(match.markets.full.handicapLines, odds.handicap, { isHandicap: true });
  }

  if (Array.isArray(match.markets.full.overUnderLines) && odds.overUnder?.length) {
    matchAndAssignLines(match.markets.full.overUnderLines, odds.overUnder, { isHandicap: false });
  }

  if (Array.isArray(match.markets.half.handicapLines) && odds.handicapHalf?.length) {
    matchAndAssignLines(match.markets.half.handicapLines, odds.handicapHalf, { isHandicap: true });
  }

  if (Array.isArray(match.markets.half.overUnderLines) && odds.overUnderHalf?.length) {
    matchAndAssignLines(match.markets.half.overUnderLines, odds.overUnderHalf, { isHandicap: false });
  }

  const europeEntry = (odds.europe || []).find(Boolean);
  if (europeEntry) {
    attachMoneyline(match, europeEntry);
  }

  if (Array.isArray(match.markets.full.handicapLines) && match.markets.full.handicapLines.length > 0) {
    match.markets.handicap = { ...match.markets.full.handicapLines[0] };
  }
  if (Array.isArray(match.markets.full.overUnderLines) && match.markets.full.overUnderLines.length > 0) {
    match.markets.ou = { ...match.markets.full.overUnderLines[0] };
  }
};

export const mergeTodayMatchesWithISports = async (
  matches: CrownMatch[],
  options: MergeOptions = {}
): Promise<CrownMatch[]> => {
  if (!Array.isArray(matches) || matches.length === 0) {
    return matches;
  }

  const apiKey = process.env.ISPORTS_API_KEY || process.env.ISPORTS_APIKEY || process.env.ISPORTS_KEY;
  if (!apiKey) {
    console.warn('⚠️ 缺少 ISPORTS_API_KEY，跳过 iSports 赔率合并');
    return matches;
  }

  const client = new ISportsClient(apiKey);
  const date = options.date || new Date().toISOString().slice(0, 10);

  const resolvedCrown = await Promise.all(matches.map((match) => resolveCrownMatch(match)));

  const crownBuckets = new Map<string, ResolvedMatch[]>();
  resolvedCrown.forEach((item) => {
    const key = buildMatchKey(item.leagueKey, item.homeKey, item.awayKey, item.timeKey);
    if (!crownBuckets.has(key)) {
      crownBuckets.set(key, []);
    }
    crownBuckets.get(key)!.push(item);
  });

  let schedule: any[] = [];
  try {
    schedule = await client.getSchedule(date);
  } catch (error) {
    console.error('❌ 获取 iSports 赛程失败:', error);
    return matches;
  }

  const resolvedISports = await Promise.all(schedule.map((item) => resolveIsportsMatch(item)));

  const matchAssociations: Array<{ crown: ResolvedMatch; isports: any }> = [];

  resolvedISports.forEach((entry) => {
    const bucket = crownBuckets.get(entry.key);
    if (!bucket || bucket.length === 0) {
      return;
    }

    if (bucket.length === 1) {
      matchAssociations.push({ crown: bucket[0], isports: entry.raw });
      return;
    }

    if (entry.matchTime) {
      let closest: ResolvedMatch | null = null;
      let minDiff = Number.POSITIVE_INFINITY;
      bucket.forEach((candidate) => {
        const ts = parseTimestamp(candidate.match.match_time || candidate.match.time || candidate.match.timer);
        if (!ts) return;
        const diff = Math.abs(entry.matchTime! - ts);
        if (diff < minDiff) {
          minDiff = diff;
          closest = candidate;
        }
      });
      if (closest) {
        matchAssociations.push({ crown: closest, isports: entry.raw });
      }
    } else {
      matchAssociations.push({ crown: bucket[0], isports: entry.raw });
    }
  });

  const matchIds = Array.from(new Set(matchAssociations.map((entry) => entry.isports.matchId || entry.isports.match_id).filter(Boolean)));

  let oddsData: OddsBundle | null = null;
  if (matchIds.length > 0) {
    try {
      const odds = await client.getMainOdds(matchIds);
      oddsData = {
        handicap: odds.handicap,
        europe: odds.europeOdds,
        overUnder: odds.overUnder,
        handicapHalf: odds.handicapHalf || [],
        overUnderHalf: odds.overUnderHalf || [],
      };
    } catch (error) {
      console.error('❌ 获取 iSports 赔率失败:', error);
    }
  }

  if (!oddsData) {
    return matches;
  }

  const oddsMap = new Map<string, OddsBundle>(
    matchIds.map((id) => {
      const handicap = (oddsData?.handicap || []).filter((item) => item.matchId === id);
      const europe = (oddsData?.europe || []).filter((item) => item.matchId === id);
      const overUnder = (oddsData?.overUnder || []).filter((item) => item.matchId === id);
      const handicapHalf = (oddsData?.handicapHalf || []).filter((item) => item.matchId === id);
      const overUnderHalf = (oddsData?.overUnderHalf || []).filter((item) => item.matchId === id);
      return [id, { handicap, europe, overUnder, handicapHalf, overUnderHalf }];
    })
  );

  matchAssociations.forEach(({ crown, isports }) => {
    const matchId = isports.matchId || isports.match_id;
    const bundle = matchId ? oddsMap.get(matchId) : null;
    if (!bundle) return;
    crown.match.isports_match_id = matchId;
    applyOddsToMatch(crown.match, bundle);
  });

  return matches;
};
