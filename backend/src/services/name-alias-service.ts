import { query } from '../models/database';
import type { LeagueAlias, TeamAlias } from '../types';

type AliasRecord = {
  canonicalKey: string;
  nameEn?: string | null;
  nameZhCn?: string | null;
  nameZhTw?: string | null;
  nameCrownZhCn?: string | null;
  aliases: string[];
};

type ResolvedName = {
  canonicalKey: string;
  displayName: string;
  fallbackName: string;
  source?: 'canonical' | 'alias' | 'fallback';
  raw?: string;
  meta?: {
    en?: string | null;
    zh_cn?: string | null;
    zh_tw?: string | null;
  };
};

const NORMALIZE_REGEX = /[\s·•'".,_\-(){}\[\]【】（）\/\\]+/g;

const normalize = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(NORMALIZE_REGEX, ' ')
    .trim()
    .toLowerCase();
  return trimmed;
};

const canonicalFromRaw = (value: string, type: 'league' | 'team'): string => {
  const normalized = normalize(value);
  return normalized ? `${type}:${normalized}` : `${type}:unknown`;
};

class NameAliasService {
  private leagueCache: AliasRecord[] = [];
  private teamCache: AliasRecord[] = [];
  private leagueRaw: LeagueAlias[] = [];
  private teamRaw: TeamAlias[] = [];
  private loadedAt = 0;
  private readonly ttl = 60 * 1000; // 1 minute

  private parseAliasesColumn(value: any): string[] {
    if (!value && value !== 0) return [];
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (value && typeof value === 'object' && Array.isArray((value as any).values)) {
      return (value as any).values as string[];
    }
    return [];
  }

  private async ensureLoaded(): Promise<void> {
    const now = Date.now();
    if (now - this.loadedAt < this.ttl && this.leagueCache.length && this.teamCache.length) {
      return;
    }

    const [leagueResult, teamResult] = await Promise.all([
      query('SELECT * FROM league_aliases'),
      query('SELECT * FROM team_aliases'),
    ]);

    const leagueRows: LeagueAlias[] = leagueResult.rows.map((row: any) => ({
      ...row,
      aliases: this.parseAliasesColumn(row.aliases),
    }));
    const teamRows: TeamAlias[] = teamResult.rows.map((row: any) => ({
      ...row,
      aliases: this.parseAliasesColumn(row.aliases),
    }));

    this.leagueRaw = leagueRows;
    this.teamRaw = teamRows;

    this.leagueCache = leagueRows.map((row) => ({
      canonicalKey: row.canonical_key,
      nameEn: row.name_en,
      nameZhCn: row.name_zh_cn,
      nameZhTw: row.name_zh_tw,
      nameCrownZhCn: row.name_crown_zh_cn,
      aliases: this.buildAliasSet(row),
    }));

    this.teamCache = teamRows.map((row) => ({
      canonicalKey: row.canonical_key,
      nameEn: row.name_en,
      nameZhCn: row.name_zh_cn,
      nameZhTw: row.name_zh_tw,
      nameCrownZhCn: row.name_crown_zh_cn,
      aliases: this.buildAliasSet(row),
    }));

    this.loadedAt = now;
  }

  private buildAliasSet(record: { name_en?: string | null; name_zh_cn?: string | null; name_zh_tw?: string | null; name_crown_zh_cn?: string | null; aliases?: string[] }): string[] {
    const set = new Set<string>();
    if (record.name_en) set.add(normalize(record.name_en));
    if (record.name_zh_cn) set.add(normalize(record.name_zh_cn));
    if (record.name_crown_zh_cn) set.add(normalize(record.name_crown_zh_cn));
    if (record.name_zh_tw) set.add(normalize(record.name_zh_tw));
    if (Array.isArray(record.aliases)) {
      record.aliases.forEach((alias) => {
        const normalized = normalize(alias);
        if (normalized) set.add(normalized);
      });
    }
    return Array.from(set).filter(Boolean);
  }

  private resolveFromCache(value: string, cache: AliasRecord[], fallbackType: 'league' | 'team'): ResolvedName {
    const raw = value || '';
    const normalized = normalize(raw);

    if (!normalized) {
      const fallbackKey = `${fallbackType}:unknown`;
      return {
        canonicalKey: fallbackKey,
        displayName: raw,
        fallbackName: raw,
        source: 'fallback',
        raw,
      };
    }

    const record = cache.find((item) => item.aliases.includes(normalized));

    if (record) {
      const display = record.nameZhCn || record.nameZhTw || record.nameEn || raw;
      return {
        canonicalKey: record.canonicalKey,
        displayName: display,
        fallbackName: raw,
        source: record.nameZhCn || record.nameZhTw || record.nameEn ? 'canonical' : 'alias',
        raw,
        meta: {
          en: record.nameEn,
          zh_cn: record.nameZhCn,
          zh_tw: record.nameZhTw,
        },
      };
    }

    const fallbackKey = canonicalFromRaw(raw, fallbackType);
    return {
      canonicalKey: fallbackKey,
      displayName: raw,
      fallbackName: raw,
      source: 'fallback',
      raw,
    };
  }

  private sanitizeAliasArray(input?: string[] | null): string[] {
    if (!Array.isArray(input)) return [];
    const set = new Set<string>();
    input.forEach((value) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (trimmed) {
        set.add(trimmed);
      }
    });
    return Array.from(set);
  }

  private invalidateCache() {
    this.loadedAt = 0;
    this.leagueCache = [];
    this.teamCache = [];
    this.leagueRaw = [];
    this.teamRaw = [];
  }

  private mapLeagueRow(row: any): LeagueAlias {
    return {
      id: row.id,
      canonical_key: row.canonical_key,
      name_en: row.name_en,
      name_zh_cn: row.name_zh_cn,
      name_zh_tw: row.name_zh_tw,
      name_crown_zh_cn: row.name_crown_zh_cn,
      aliases: this.parseAliasesColumn(row.aliases),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapTeamRow(row: any): TeamAlias {
    return {
      id: row.id,
      canonical_key: row.canonical_key,
      name_en: row.name_en,
      name_zh_cn: row.name_zh_cn,
      name_crown_zh_cn: row.name_crown_zh_cn,
      name_zh_tw: row.name_zh_tw,
      aliases: this.parseAliasesColumn(row.aliases),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async listLeagues(search?: string): Promise<LeagueAlias[]> {
    const whereClauses: string[] = [];
    const params: any[] = [];
    if (search && search.trim()) {
      const pattern = `%${search.trim()}%`;
      params.push(pattern);
      whereClauses.push(`(canonical_key ILIKE $${params.length} OR COALESCE(name_en,'') ILIKE $${params.length} OR COALESCE(name_zh_cn,'') ILIKE $${params.length} OR COALESCE(name_zh_tw,'') ILIKE $${params.length} OR aliases::text ILIKE $${params.length})`);
    }

    const sql = `SELECT * FROM league_aliases ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''} ORDER BY updated_at DESC`;
    const result = await query(sql, params);
    return result.rows.map((row) => this.mapLeagueRow(row));
  }

  async listTeams(search?: string): Promise<TeamAlias[]> {
    const whereClauses: string[] = [];
    const params: any[] = [];
    if (search && search.trim()) {
      const pattern = `%${search.trim()}%`;
      params.push(pattern);
      whereClauses.push(`(canonical_key ILIKE $${params.length} OR COALESCE(name_en,'') ILIKE $${params.length} OR COALESCE(name_zh_cn,'') ILIKE $${params.length} OR COALESCE(name_zh_tw,'') ILIKE $${params.length} OR aliases::text ILIKE $${params.length})`);
    }

    const sql = `SELECT * FROM team_aliases ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''} ORDER BY updated_at DESC`;
    const result = await query(sql, params);
    return result.rows.map((row) => this.mapTeamRow(row));
  }

  async getAllLeagues(): Promise<LeagueAlias[]> {
    const result = await query('SELECT * FROM league_aliases ORDER BY canonical_key');
    return result.rows.map((row) => this.mapLeagueRow(row));
  }

  async getAllTeams(): Promise<TeamAlias[]> {
    const result = await query('SELECT * FROM team_aliases ORDER BY canonical_key');
    return result.rows.map((row) => this.mapTeamRow(row));
  }

  async getLeagueByKey(canonicalKey: string): Promise<LeagueAlias | null> {
    const result = await query('SELECT * FROM league_aliases WHERE canonical_key = $1', [canonicalKey]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapLeagueRow(result.rows[0]);
  }

  async getTeamByKey(canonicalKey: string): Promise<TeamAlias | null> {
    const result = await query('SELECT * FROM team_aliases WHERE canonical_key = $1', [canonicalKey]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapTeamRow(result.rows[0]);
  }

  async createLeagueAlias(payload: {
    canonicalKey?: string;
    nameEn?: string | null;
    nameZhCn?: string | null;
    nameZhTw?: string | null;
    nameCrownZhCn?: string | null;
    aliases?: string[];
  }): Promise<LeagueAlias> {
    const primaryName = payload.nameZhCn || payload.nameZhTw || payload.nameEn || payload.nameCrownZhCn;
    const canonicalKey = (payload.canonicalKey && payload.canonicalKey.trim()) || this.normalizeKey('league', primaryName || '');
    if (!canonicalKey || canonicalKey.endsWith(':unknown')) {
      throw new Error('缺少 canonical_key 或有效名称');
    }

    const aliases = this.sanitizeAliasArray(payload.aliases);

    const result = await query(
      `INSERT INTO league_aliases (canonical_key, name_en, name_zh_cn, name_zh_tw, name_crown_zh_cn, aliases, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (canonical_key) DO UPDATE SET
         name_en = COALESCE(EXCLUDED.name_en, league_aliases.name_en),
         name_zh_cn = COALESCE(EXCLUDED.name_zh_cn, league_aliases.name_zh_cn),
         name_zh_tw = COALESCE(EXCLUDED.name_zh_tw, league_aliases.name_zh_tw),
         name_crown_zh_cn = COALESCE(EXCLUDED.name_crown_zh_cn, league_aliases.name_crown_zh_cn),
         aliases = CASE WHEN EXCLUDED.aliases::text = '[]' THEN league_aliases.aliases ELSE EXCLUDED.aliases END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [canonicalKey, payload.nameEn || null, payload.nameZhCn || null, payload.nameZhTw || null, payload.nameCrownZhCn || null, JSON.stringify(aliases)]
    );

    this.invalidateCache();
    return this.mapLeagueRow(result.rows[0]);
  }

  async updateLeagueAlias(id: number, payload: {
    canonicalKey?: string;
    nameEn?: string | null;
    nameZhCn?: string | null;
    nameZhTw?: string | null;
    nameCrownZhCn?: string | null;
    aliases?: string[];
  }): Promise<LeagueAlias> {
    const aliases = this.sanitizeAliasArray(payload.aliases);
    const canonical = payload.canonicalKey && payload.canonicalKey.trim()
      ? payload.canonicalKey.trim()
      : undefined;
    if (canonical && canonical.endsWith(':unknown')) {
      throw new Error('canonical_key 不可为 unknown');
    }

    const result = await query(
      `UPDATE league_aliases SET
         canonical_key = COALESCE($2, canonical_key),
         name_en = COALESCE($3, name_en),
         name_zh_cn = COALESCE($4, name_zh_cn),
         name_zh_tw = COALESCE($5, name_zh_tw),
         name_crown_zh_cn = COALESCE($6, name_crown_zh_cn),
         aliases = $7::jsonb,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, canonical || null, payload.nameEn || null, payload.nameZhCn || null, payload.nameZhTw || null, payload.nameCrownZhCn || null, JSON.stringify(aliases)]
    );

    if (result.rows.length === 0) {
      throw new Error('记录不存在');
    }

    this.invalidateCache();
    return this.mapLeagueRow(result.rows[0]);
  }

  async deleteLeagueAlias(id: number): Promise<void> {
    await query('DELETE FROM league_aliases WHERE id = $1', [id]);
    this.invalidateCache();
  }

  async createTeamAlias(payload: {
    canonicalKey?: string;
    nameEn?: string | null;
    nameZhCn?: string | null;
    nameZhTw?: string | null;
    nameCrownZhCn?: string | null;
    aliases?: string[];
  }): Promise<TeamAlias> {
    const primaryName = payload.nameZhCn || payload.nameZhTw || payload.nameEn || payload.nameCrownZhCn;
    const canonicalKey = (payload.canonicalKey && payload.canonicalKey.trim()) || this.normalizeKey('team', primaryName || '');
    if (!canonicalKey || canonicalKey.endsWith(':unknown')) {
      throw new Error('缺少 canonical_key 或有效名称');
    }

    const aliases = this.sanitizeAliasArray(payload.aliases);

    const result = await query(
      `INSERT INTO team_aliases (canonical_key, name_en, name_zh_cn, name_zh_tw, name_crown_zh_cn, aliases, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (canonical_key) DO UPDATE SET
         name_en = COALESCE(EXCLUDED.name_en, team_aliases.name_en),
         name_zh_cn = COALESCE(EXCLUDED.name_zh_cn, team_aliases.name_zh_cn),
         name_zh_tw = COALESCE(EXCLUDED.name_zh_tw, team_aliases.name_zh_tw),
         name_crown_zh_cn = COALESCE(EXCLUDED.name_crown_zh_cn, team_aliases.name_crown_zh_cn),
         aliases = CASE WHEN EXCLUDED.aliases::text = '[]' THEN team_aliases.aliases ELSE EXCLUDED.aliases END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [canonicalKey, payload.nameEn || null, payload.nameZhCn || null, payload.nameZhTw || null, payload.nameCrownZhCn || null, JSON.stringify(aliases)]
    );

    this.invalidateCache();
    return this.mapTeamRow(result.rows[0]);
  }

  async updateTeamAlias(id: number, payload: {
    canonicalKey?: string;
    nameEn?: string | null;
    nameZhCn?: string | null;
    nameZhTw?: string | null;
    nameCrownZhCn?: string | null;
    aliases?: string[];
  }): Promise<TeamAlias> {
    const aliases = this.sanitizeAliasArray(payload.aliases);
    const canonical = payload.canonicalKey && payload.canonicalKey.trim()
      ? payload.canonicalKey.trim()
      : undefined;
    if (canonical && canonical.endsWith(':unknown')) {
      throw new Error('canonical_key 不可为 unknown');
    }

    const result = await query(
      `UPDATE team_aliases SET
         canonical_key = COALESCE($2, canonical_key),
         name_en = COALESCE($3, name_en),
         name_zh_cn = COALESCE($4, name_zh_cn),
         name_zh_tw = COALESCE($5, name_zh_tw),
         name_crown_zh_cn = COALESCE($6, name_crown_zh_cn),
         aliases = $7::jsonb,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, canonical || null, payload.nameEn || null, payload.nameZhCn || null, payload.nameZhTw || null, payload.nameCrownZhCn || null, JSON.stringify(aliases)]
    );

    if (result.rows.length === 0) {
      throw new Error('记录不存在');
    }

    this.invalidateCache();
    return this.mapTeamRow(result.rows[0]);
  }

  async deleteTeamAlias(id: number): Promise<void> {
    await query('DELETE FROM team_aliases WHERE id = $1', [id]);
    this.invalidateCache();
  }

  async getLeagueByCanonical(canonicalKey: string): Promise<LeagueAlias | null> {
    const result = await query('SELECT * FROM league_aliases WHERE canonical_key = $1 LIMIT 1', [canonicalKey]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapLeagueRow(result.rows[0]);
  }

  async getTeamByCanonical(canonicalKey: string): Promise<TeamAlias | null> {
    const result = await query('SELECT * FROM team_aliases WHERE canonical_key = $1 LIMIT 1', [canonicalKey]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapTeamRow(result.rows[0]);
  }

  async resolveLeague(name: string): Promise<ResolvedName> {
    await this.ensureLoaded();
    return this.resolveFromCache(name, this.leagueCache, 'league');
  }

  async resolveTeam(name: string): Promise<ResolvedName> {
    await this.ensureLoaded();
    return this.resolveFromCache(name, this.teamCache, 'team');
  }

  normalizeKey(type: 'league' | 'team', name: string): string {
    const normalized = normalize(name);
    if (!normalized) {
      return `${type}:unknown`;
    }
    return `${type}:${normalized}`;
  }
}

export const nameAliasService = new NameAliasService();
export type { ResolvedName };
