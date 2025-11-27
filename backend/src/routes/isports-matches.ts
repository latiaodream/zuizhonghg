import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { ISportsClient } from '../services/isports-client';
import { pool } from '../models/database';

const router = Router();
router.use(authenticateToken);

const ensureAdmin = (req: any, res: any, next: any) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '仅管理员可访问' });
  }
  return next();
};

// 初始化 iSports 客户端
const isportsClient = new ISportsClient(
  process.env.ISPORTS_API_KEY || 'GvpziueL9ouzIJNj'
);

/**
 * 根据 iSports 名称查找映射的简体中文名称
 */
async function findMappedName(
  type: 'league' | 'team',
  isportsName: string
): Promise<{ mapped: boolean; name: string }> {
  try {
    const tableName = type === 'league' ? 'league_aliases' : 'team_aliases';

    // 1. 尝试精确匹配 name_zh_tw (iSports 使用繁体中文)
    let result = await pool.query(
      `SELECT name_zh_cn, name_zh_tw, name_en FROM ${tableName} WHERE name_zh_tw = $1 LIMIT 1`,
      [isportsName]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      // 优先返回简体中文，如果没有则返回繁体中文，最后才是英文
      const displayName = row.name_zh_cn || row.name_zh_tw || row.name_en || isportsName;
      return { mapped: true, name: displayName };
    }

    // 2. 尝试精确匹配 name_en (iSports 也可能返回英文)
    result = await pool.query(
      `SELECT name_zh_cn, name_zh_tw, name_en FROM ${tableName} WHERE name_en = $1 LIMIT 1`,
      [isportsName]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      // 优先返回简体中文，如果没有则返回繁体中文，最后才是英文
      const displayName = row.name_zh_cn || row.name_zh_tw || row.name_en || isportsName;
      return { mapped: true, name: displayName };
    }

    // 3. 未找到映射，返回原名
    return { mapped: false, name: isportsName };
  } catch (error) {
    console.error(`查找映射失败 (${type}):`, error);
    return { mapped: false, name: isportsName };
  }
}

/**
 * 获取 iSports 赛事列表（带名称映射，仅返回有皇冠赔率的赛事）
 * GET /api/isports-matches?date=2025-11-06
 */
router.get('/', ensureAdmin, async (req, res) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0];

    console.log(`📥 获取 iSports 赛事列表: ${date}`);

    // 1. 获取所有赛事
    let matches;
    try {
      matches = await isportsClient.getSchedule(date);
      console.log(`✅ 获取到 ${matches.length} 场赛事`);
    } catch (error: any) {
      console.error('❌ 获取赛程失败:', error.message);
      return res.status(500).json({
        success: false,
        message: `获取赛程失败: ${error.message}`,
      });
    }

    if (!matches || matches.length === 0) {
      console.log(`ℹ️ ${date} 没有赛事`);
      return res.json({
        success: true,
        data: {
          matches: [],
          total: 0,
          totalAll: 0,
          date,
        },
      });
    }

    // 2. 获取皇冠赔率（分批获取，避免 URL 过长）
    console.log(`📥 获取皇冠赔率...`);
    const matchIds = matches.map(m => m.matchId);
    const batchSize = 50; // 每批最多 50 场比赛
    let allOddsData = {
      handicap: [] as any[],
      europeOdds: [] as any[],
      overUnder: [] as any[],
      handicapHalf: [] as any[],
      overUnderHalf: [] as any[],
    };

    try {
      for (let i = 0; i < matchIds.length; i += batchSize) {
        const batchIds = matchIds.slice(i, i + batchSize);
        console.log(`  批次 ${Math.floor(i / batchSize) + 1}: ${batchIds.length} 场比赛`);

        const oddsData = await isportsClient.getMainOdds(batchIds, ['3']);
        allOddsData.handicap.push(...oddsData.handicap);
        allOddsData.europeOdds.push(...oddsData.europeOdds);
        allOddsData.overUnder.push(...oddsData.overUnder);
        if (oddsData.handicapHalf) allOddsData.handicapHalf.push(...oddsData.handicapHalf);
        if (oddsData.overUnderHalf) allOddsData.overUnderHalf.push(...oddsData.overUnderHalf);
      }
      console.log(`✅ 获取到赔率: 让球盘 ${allOddsData.handicap.length}, 独赢盘 ${allOddsData.europeOdds.length}, 大小球 ${allOddsData.overUnder.length}`);
    } catch (error: any) {
      console.error('❌ 获取赔率失败:', error.message);
      // 赔率获取失败，返回所有赛事但不筛选
      console.log('⚠️ 赔率获取失败，返回所有赛事');
    }

    // 3. 筛选出有皇冠赔率的比赛
    const matchesWithOdds = matches.filter(match => {
      const hasHandicap = allOddsData.handicap.some(h => h.matchId === match.matchId && h.companyId === '3');
      const hasEurope = allOddsData.europeOdds.some(e => e.matchId === match.matchId && e.companyId === '3');
      const hasOverUnder = allOddsData.overUnder.some(o => o.matchId === match.matchId && o.companyId === '3');
      return hasHandicap || hasEurope || hasOverUnder;
    });

    console.log(`✅ 筛选出 ${matchesWithOdds.length} 场有皇冠赔率的赛事`);

    // 4. 为每场比赛添加映射后的中文名称
    const matchesWithMapping = await Promise.all(
      matchesWithOdds.map(async (match) => {
        const leagueMapping = await findMappedName('league', match.leagueName);
        const homeMapping = await findMappedName('team', match.homeName);
        const awayMapping = await findMappedName('team', match.awayName);

        return {
          ...match,
          // 映射后的名称
          leagueNameZhCn: leagueMapping.name,
          homeNameZhCn: homeMapping.name,
          awayNameZhCn: awayMapping.name,
          // 是否已映射
          leagueMapped: leagueMapping.mapped,
          homeMapped: homeMapping.mapped,
          awayMapped: awayMapping.mapped,
        };
      })
    );

    res.json({
      success: true,
      data: {
        matches: matchesWithMapping,
        total: matchesWithMapping.length,
        totalAll: matches.length,
        date,
      },
    });
  } catch (error: any) {
    console.error('❌ 获取 iSports 赛事失败:', error);
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      message: error.message || '获取赛事失败',
    });
  }
});

export default router;

