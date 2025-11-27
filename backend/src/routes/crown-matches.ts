import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { crownMatchService } from '../services/crown-match-service';
import { nameAliasService } from '../services/name-alias-service';
import { query } from '../models/database';

const router = Router();
router.use(authenticateToken);

const ensureAdmin = (req: any, res: any, next: any) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '仅管理员可访问' });
  }
  return next();
};

// GET /api/crown-matches - 获取赛事列表
router.get('/', ensureAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const leagueMatched = req.query.leagueMatched === 'true' ? true : req.query.leagueMatched === 'false' ? false : undefined;
    const homeMatched = req.query.homeMatched === 'true' ? true : req.query.homeMatched === 'false' ? false : undefined;
    const awayMatched = req.query.awayMatched === 'true' ? true : req.query.awayMatched === 'false' ? false : undefined;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const result = await crownMatchService.listMatches({
      page,
      pageSize,
      leagueMatched,
      homeMatched,
      awayMatched,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('获取赛事列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取赛事列表失败',
    });
  }
});

// GET /api/crown-matches/stats - 获取匹配统计
router.get('/stats', ensureAdmin, async (req, res) => {
  try {
    const stats = await crownMatchService.getMatchStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('获取匹配统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取匹配统计失败',
    });
  }
});

// GET /api/crown-matches/unmatched-leagues - 获取未匹配的联赛
router.get('/unmatched-leagues', ensureAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const leagues = await crownMatchService.getUnmatchedLeagues(limit);

    res.json({
      success: true,
      data: leagues,
    });
  } catch (error: any) {
    console.error('获取未匹配联赛失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取未匹配联赛失败',
    });
  }
});

// GET /api/crown-matches/unmatched-teams - 获取未匹配的球队
router.get('/unmatched-teams', ensureAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const teams = await crownMatchService.getUnmatchedTeams(limit);

    res.json({
      success: true,
      data: teams,
    });
  } catch (error: any) {
    console.error('获取未匹配球队失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取未匹配球队失败',
    });
  }
});

// DELETE /api/crown-matches/old - 删除过期赛事
router.delete('/old', ensureAdmin, async (req, res) => {
  try {
    const daysAgo = parseInt(req.query.daysAgo as string) || 7;
    const count = await crownMatchService.deleteOldMatches(daysAgo);

    res.json({
      success: true,
      data: { deleted: count },
      message: `已删除 ${count} 场过期赛事`,
    });
  } catch (error: any) {
    console.error('删除过期赛事失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除过期赛事失败',
    });
  }
});

// POST /api/crown-matches/rematch - 重新匹配赛事
router.post('/rematch', ensureAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    console.log(`📥 开始重新匹配赛事: ${startDate} ~ ${endDate || startDate}`);

    // 1. 获取指定日期范围的赛事
    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereClauses.push(`match_time >= $${paramIndex++}::date`);
      params.push(startDate);
    }

    if (endDate) {
      whereClauses.push(`match_time < ($${paramIndex++}::date + interval '1 day')`);
      params.push(endDate);
    } else if (startDate) {
      // 如果只有 startDate，默认只匹配当天
      whereClauses.push(`match_time < ($${paramIndex++}::date + interval '1 day')`);
      params.push(startDate);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const matchesResult = await query(
      `SELECT * FROM crown_matches ${whereClause} ORDER BY id`,
      params
    );

    const matches = matchesResult.rows;
    console.log(`✅ 找到 ${matches.length} 场赛事需要重新匹配`);

    if (matches.length === 0) {
      return res.json({
        success: true,
        data: {
          total: 0,
          matched: 0,
          unmatched: 0,
        },
        message: '没有找到需要匹配的赛事',
      });
    }

    // 2. 重新匹配每场赛事
    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const match of matches) {
      try {
        // 匹配联赛
        const leagueResult = await matchName(match.crown_league, 'league');

        // 匹配主队
        const homeResult = await matchName(match.crown_home, 'team');

        // 匹配客队
        const awayResult = await matchName(match.crown_away, 'team');

        // 更新数据库
        await query(`
          UPDATE crown_matches
          SET
            league_matched = $1,
            home_matched = $2,
            away_matched = $3,
            league_alias_id = $4,
            home_alias_id = $5,
            away_alias_id = $6,
            league_match_method = $7,
            home_match_method = $8,
            away_match_method = $9,
            updated_at = NOW()
          WHERE id = $10
        `, [
          leagueResult.matched,
          homeResult.matched,
          awayResult.matched,
          leagueResult.id || null,
          homeResult.id || null,
          awayResult.id || null,
          leagueResult.method || null,
          homeResult.method || null,
          awayResult.method || null,
          match.id,
        ]);

        if (leagueResult.matched && homeResult.matched && awayResult.matched) {
          matchedCount++;
        } else {
          unmatchedCount++;
        }
      } catch (error: any) {
        console.error(`❌ 匹配赛事失败 (ID=${match.id}):`, error.message);
        unmatchedCount++;
      }
    }

    console.log(`✅ 重新匹配完成: ${matchedCount} 场完全匹配, ${unmatchedCount} 场未完全匹配`);

    res.json({
      success: true,
      data: {
        total: matches.length,
        matched: matchedCount,
        unmatched: unmatchedCount,
      },
      message: `重新匹配完成: ${matchedCount}/${matches.length} 场完全匹配`,
    });
  } catch (error: any) {
    console.error('重新匹配赛事失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重新匹配赛事失败',
    });
  }
});

/**
 * 匹配名称（联赛或球队）
 */
async function matchName(
  name: string,
  type: 'league' | 'team'
): Promise<{ matched: boolean; id?: number; method?: string }> {
  try {
    const allItems = type === 'league'
      ? await nameAliasService.getAllLeagues()
      : await nameAliasService.getAllTeams();

    // 1. 精确匹配 name_zh_cn（iSports 简体）
    for (const item of allItems) {
      if (item.name_zh_cn === name) {
        return { matched: true, id: item.id, method: 'exact_zh_cn' };
      }
    }

    // 2. 精确匹配 name_crown_zh_cn（皇冠简体）
    for (const item of allItems) {
      if (item.name_crown_zh_cn === name) {
        return { matched: true, id: item.id, method: 'exact_crown' };
      }
    }

    // 3. 通过别名精确匹配
    const result = type === 'league'
      ? await nameAliasService.resolveLeague(name)
      : await nameAliasService.resolveTeam(name);

    if (result && result.canonicalKey) {
      const item = type === 'league'
        ? await nameAliasService.getLeagueByKey(result.canonicalKey)
        : await nameAliasService.getTeamByKey(result.canonicalKey);

      if (item) {
        return { matched: true, id: item.id, method: 'alias' };
      }
    }

    // 4. 模糊匹配（相似度 >= 0.7）
    let bestMatch: { item: any; score: number } | null = null;

    for (const item of allItems) {
      // 优先与 name_zh_cn 比较（iSports 简体）
      if (item.name_zh_cn) {
        const score = similarity(name, item.name_zh_cn);
        if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { item, score };
        }
      }

      // 与 name_crown_zh_cn 比较（皇冠简体）
      if (item.name_crown_zh_cn) {
        const score = similarity(name, item.name_crown_zh_cn);
        if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { item, score };
        }
      }
    }

    if (bestMatch) {
      return { matched: true, id: bestMatch.item.id, method: 'fuzzy' };
    }

    return { matched: false };
  } catch (error: any) {
    console.error(`匹配${type}失败:`, error.message);
    return { matched: false };
  }
}

/**
 * 计算字符串相似度
 */
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) {
    return 1.0;
  }

  // 包含关系得分更高
  if (longer.includes(shorter)) {
    return 0.8 + (shorter.length / longer.length) * 0.2;
  }

  // 计算编辑距离
  const editDistance = levenshteinDistance(s1, s2);
  return (longer.length - editDistance) / longer.length;
}

/**
 * 计算编辑距离
 */
function levenshteinDistance(s1: string, s2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
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

  return matrix[s2.length][s1.length];
}

export { router as crownMatchRoutes };

