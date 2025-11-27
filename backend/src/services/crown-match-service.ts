import { query } from '../models/database';
import { CrownMatch, CrownMatchStats } from '../types';

/**
 * 皇冠赛事数据服务
 * 管理皇冠赛事数据和匹配统计
 */
class CrownMatchService {
  /**
   * 插入或更新皇冠赛事
   */
  async upsertMatch(data: {
    crownGid: string;
    crownLeague: string;
    crownHome: string;
    crownAway: string;
    matchTime?: string;
    leagueMatched?: boolean;
    homeMatched?: boolean;
    awayMatched?: boolean;
    leagueAliasId?: number;
    homeAliasId?: number;
    awayAliasId?: number;
    leagueMatchMethod?: string;
    homeMatchMethod?: string;
    awayMatchMethod?: string;
  }): Promise<CrownMatch> {
    const sql = `
      INSERT INTO crown_matches (
        crown_gid, crown_league, crown_home, crown_away, match_time,
        league_matched, home_matched, away_matched,
        league_alias_id, home_alias_id, away_alias_id,
        league_match_method, home_match_method, away_match_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (crown_gid) DO UPDATE SET
        crown_league = EXCLUDED.crown_league,
        crown_home = EXCLUDED.crown_home,
        crown_away = EXCLUDED.crown_away,
        match_time = EXCLUDED.match_time,
        league_matched = EXCLUDED.league_matched,
        home_matched = EXCLUDED.home_matched,
        away_matched = EXCLUDED.away_matched,
        league_alias_id = EXCLUDED.league_alias_id,
        home_alias_id = EXCLUDED.home_alias_id,
        away_alias_id = EXCLUDED.away_alias_id,
        league_match_method = EXCLUDED.league_match_method,
        home_match_method = EXCLUDED.home_match_method,
        away_match_method = EXCLUDED.away_match_method,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await query(sql, [
      data.crownGid,
      data.crownLeague,
      data.crownHome,
      data.crownAway,
      data.matchTime || null,
      data.leagueMatched || false,
      data.homeMatched || false,
      data.awayMatched || false,
      data.leagueAliasId || null,
      data.homeAliasId || null,
      data.awayAliasId || null,
      data.leagueMatchMethod || null,
      data.homeMatchMethod || null,
      data.awayMatchMethod || null,
    ]);

    return this.mapRow(result.rows[0]);
  }

  /**
   * 获取匹配统计
   */
  async getMatchStats(): Promise<CrownMatchStats> {
    const sql = `
      SELECT
        COUNT(*) as total_matches,
        SUM(CASE WHEN league_matched THEN 1 ELSE 0 END) as league_matched,
        SUM(CASE WHEN home_matched THEN 1 ELSE 0 END) as home_matched,
        SUM(CASE WHEN away_matched THEN 1 ELSE 0 END) as away_matched,
        SUM(CASE WHEN league_matched AND home_matched AND away_matched THEN 1 ELSE 0 END) as fully_matched
      FROM crown_matches
    `;

    const result = await query(sql);
    const row = result.rows[0];

    const total = parseInt(row.total_matches) || 0;
    const leagueMatched = parseInt(row.league_matched) || 0;
    const homeMatched = parseInt(row.home_matched) || 0;
    const awayMatched = parseInt(row.away_matched) || 0;
    const fullyMatched = parseInt(row.fully_matched) || 0;

    return {
      total_matches: total,
      league_matched: leagueMatched,
      home_matched: homeMatched,
      away_matched: awayMatched,
      fully_matched: fullyMatched,
      league_match_rate: total > 0 ? (leagueMatched / total) * 100 : 0,
      home_match_rate: total > 0 ? (homeMatched / total) * 100 : 0,
      away_match_rate: total > 0 ? (awayMatched / total) * 100 : 0,
      full_match_rate: total > 0 ? (fullyMatched / total) * 100 : 0,
    };
  }

  /**
   * 获取未匹配的联赛列表
   */
  async getUnmatchedLeagues(limit: number = 100): Promise<string[]> {
    const sql = `
      SELECT DISTINCT crown_league
      FROM crown_matches
      WHERE league_matched = FALSE
      ORDER BY crown_league
      LIMIT $1
    `;

    const result = await query(sql, [limit]);
    return result.rows.map((row: any) => row.crown_league);
  }

  /**
   * 获取未匹配的球队列表
   */
  async getUnmatchedTeams(limit: number = 100): Promise<string[]> {
    const sql = `
      SELECT team_name, COUNT(*) as count
      FROM (
        SELECT crown_home as team_name FROM crown_matches WHERE home_matched = FALSE
        UNION ALL
        SELECT crown_away as team_name FROM crown_matches WHERE away_matched = FALSE
      ) t
      GROUP BY team_name
      ORDER BY count DESC, team_name
      LIMIT $1
    `;

    const result = await query(sql, [limit]);
    return result.rows.map((row: any) => row.team_name);
  }

  /**
   * 清空所有皇冠赛事数据
   */
  async clearAll(): Promise<void> {
    await query('TRUNCATE TABLE crown_matches RESTART IDENTITY CASCADE');
  }

  /**
   * 删除过期的赛事（比赛时间在指定天数之前）
   */
  async deleteOldMatches(daysAgo: number = 7): Promise<number> {
    const sql = `
      DELETE FROM crown_matches
      WHERE match_time < NOW() - INTERVAL '${daysAgo} days'
    `;

    const result = await query(sql);
    return result.rowCount || 0;
  }

  /**
   * 获取所有赛事（分页）
   */
  async listMatches(options: {
    page?: number;
    pageSize?: number;
    leagueMatched?: boolean;
    homeMatched?: boolean;
    awayMatched?: boolean;
    startDate?: string;  // YYYY-MM-DD
    endDate?: string;    // YYYY-MM-DD
  } = {}): Promise<{ matches: CrownMatch[]; total: number }> {
    const { page = 1, pageSize = 50, leagueMatched, homeMatched, awayMatched, startDate, endDate } = options;
    const offset = (page - 1) * pageSize;

    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (leagueMatched !== undefined) {
      whereClauses.push(`league_matched = $${paramIndex++}`);
      params.push(leagueMatched);
    }

    if (homeMatched !== undefined) {
      whereClauses.push(`home_matched = $${paramIndex++}`);
      params.push(homeMatched);
    }

    if (awayMatched !== undefined) {
      whereClauses.push(`away_matched = $${paramIndex++}`);
      params.push(awayMatched);
    }

    // 日期范围筛选
    if (startDate) {
      whereClauses.push(`match_time >= $${paramIndex++}::date`);
      params.push(startDate);
    }

    if (endDate) {
      whereClauses.push(`match_time < ($${paramIndex++}::date + interval '1 day')`);
      params.push(endDate);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 获取总数
    const countSql = `SELECT COUNT(*) FROM crown_matches ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].count) || 0;

    // 获取数据
    const dataSql = `
      SELECT * FROM crown_matches
      ${whereClause}
      ORDER BY match_time ASC, id ASC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const dataResult = await query(dataSql, [...params, pageSize, offset]);

    return {
      matches: dataResult.rows.map((row: any) => this.mapRow(row)),
      total,
    };
  }

  /**
   * 映射数据库行到 CrownMatch 对象
   */
  private mapRow(row: any): CrownMatch {
    return {
      id: row.id,
      crown_gid: row.crown_gid,
      crown_league: row.crown_league,
      crown_home: row.crown_home,
      crown_away: row.crown_away,
      match_time: row.match_time,
      league_matched: row.league_matched,
      home_matched: row.home_matched,
      away_matched: row.away_matched,
      league_alias_id: row.league_alias_id,
      home_alias_id: row.home_alias_id,
      away_alias_id: row.away_alias_id,
      league_match_method: row.league_match_method,
      home_match_method: row.home_match_method,
      away_match_method: row.away_match_method,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export const crownMatchService = new CrownMatchService();

