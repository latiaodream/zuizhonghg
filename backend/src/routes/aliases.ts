import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';
import { authenticateToken } from '../middleware/auth';
import { nameAliasService } from '../services/name-alias-service';
import { importLeaguesFromExcel, importTeamsFromExcel } from '../services/alias-import-service';
import { pool } from '../models/database';
import { ISportsClient } from '../services/isports-client';

/**
 * 生成 canonical_key
 */
function generateCanonicalKey(type: 'league' | 'team', name: string): string {
  return nameAliasService.normalizeKey(type, name);
}

const router = Router();
router.use(authenticateToken);

const ensureAdmin = (req: any, res: any, next: any) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '仅管理员可访问' });
  }
  return next();
};

// 配置文件上传
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      return cb(new Error('只支持 Excel 文件 (.xlsx, .xls)'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  }
});

const parseAliasesInput = (input: any): string[] => {
  if (!input && input !== 0) return [];
  if (Array.isArray(input)) {
    return input
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[\n,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

router.get('/leagues', ensureAdmin, async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const records = await nameAliasService.listLeagues(search);
    res.json({ success: true, data: records });
  } catch (error: any) {
    console.error('获取联赛别名失败:', error);
    res.status(500).json({ success: false, error: '获取联赛别名失败' });
  }
});

router.post('/leagues', ensureAdmin, async (req, res) => {
  try {
    const payload = {
      canonicalKey: typeof req.body.canonical_key === 'string' ? req.body.canonical_key.trim() : undefined,
      nameEn: req.body.name_en ?? null,
      nameZhCn: req.body.name_zh_cn ?? null,
      nameZhTw: req.body.name_zh_tw ?? null,
      aliases: parseAliasesInput(req.body.aliases),
    };
    const record = await nameAliasService.createLeagueAlias(payload);
    res.json({ success: true, data: record });
  } catch (error: any) {
    console.error('创建联赛别名失败:', error);
    res.status(400).json({ success: false, error: error.message || '创建联赛别名失败' });
  }
});

router.put('/leagues/:id', ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }
    const payload = {
      canonicalKey: typeof req.body.canonical_key === 'string' ? req.body.canonical_key.trim() : undefined,
      nameEn: req.body.name_en ?? null,
      nameZhCn: req.body.name_zh_cn ?? null,
      nameZhTw: req.body.name_zh_tw ?? null,
      aliases: parseAliasesInput(req.body.aliases),
    };
    const record = await nameAliasService.updateLeagueAlias(id, payload);
    res.json({ success: true, data: record });
  } catch (error: any) {
    console.error('更新联赛别名失败:', error);
    res.status(400).json({ success: false, error: error.message || '更新联赛别名失败' });
  }
});

router.delete('/leagues/:id', ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }
    await nameAliasService.deleteLeagueAlias(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('删除联赛别名失败:', error);
    res.status(500).json({ success: false, error: '删除联赛别名失败' });
  }
});

router.get('/teams', ensureAdmin, async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const records = await nameAliasService.listTeams(search);
    res.json({ success: true, data: records });
  } catch (error: any) {
    console.error('获取球队别名失败:', error);
    res.status(500).json({ success: false, error: '获取球队别名失败' });
  }
});

router.post('/teams', ensureAdmin, async (req, res) => {
  try {
    const payload = {
      canonicalKey: typeof req.body.canonical_key === 'string' ? req.body.canonical_key.trim() : undefined,
      nameEn: req.body.name_en ?? null,
      nameZhCn: req.body.name_zh_cn ?? null,
      nameZhTw: req.body.name_zh_tw ?? null,
      aliases: parseAliasesInput(req.body.aliases),
    };
    const record = await nameAliasService.createTeamAlias(payload);
    res.json({ success: true, data: record });
  } catch (error: any) {
    console.error('创建球队别名失败:', error);
    res.status(400).json({ success: false, error: error.message || '创建球队别名失败' });
  }
});

router.put('/teams/:id', ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }
    const payload = {
      canonicalKey: typeof req.body.canonical_key === 'string' ? req.body.canonical_key.trim() : undefined,
      nameEn: req.body.name_en ?? null,
      nameZhCn: req.body.name_zh_cn ?? null,
      nameZhTw: req.body.name_zh_tw ?? null,
      aliases: parseAliasesInput(req.body.aliases),
    };
    const record = await nameAliasService.updateTeamAlias(id, payload);
    res.json({ success: true, data: record });
  } catch (error: any) {
    console.error('更新球队别名失败:', error);
    res.status(400).json({ success: false, error: error.message || '更新球队别名失败' });
  }
});

router.delete('/teams/:id', ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: '无效的 ID' });
    }
    await nameAliasService.deleteTeamAlias(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('删除球队别名失败:', error);
    res.status(500).json({ success: false, error: '删除球队别名失败' });
  }
});

// 导入联赛翻译（Excel 文件上传）
router.post('/leagues/import', ensureAdmin, upload.single('file'), async (req, res) => {
  let filePath: string | undefined;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传文件' });
    }

    filePath = req.file.path;
    console.log(`📥 开始导入联赛翻译: ${req.file.originalname}`);

    const result = await importLeaguesFromExcel(filePath);

    // 删除临时文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: '导入失败',
        details: result.errors,
      });
    }

    res.json({
      success: true,
      data: {
        type: result.type,
        total: result.total,
        updated: result.updated,
        skipped: result.skipped,
        notFound: result.notFound,
      },
      message: `导入完成：更新 ${result.updated} 个，跳过 ${result.skipped} 个，未找到 ${result.notFound} 个`,
    });

  } catch (error: any) {
    console.error('导入联赛翻译失败:', error);

    // 清理临时文件
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.status(500).json({
      success: false,
      error: error.message || '导入联赛翻译失败',
    });
  }
});

// 导入球队翻译（Excel 文件上传）
router.post('/teams/import', ensureAdmin, upload.single('file'), async (req, res) => {
  let filePath: string | undefined;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传文件' });
    }

    filePath = req.file.path;
    console.log(`📥 开始导入球队翻译: ${req.file.originalname}`);

    const result = await importTeamsFromExcel(filePath);

    // 删除临时文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: '导入失败',
        details: result.errors,
      });
    }

    res.json({
      success: true,
      data: {
        type: result.type,
        total: result.total,
        updated: result.updated,
        skipped: result.skipped,
        notFound: result.notFound,
      },
      message: `导入完成：更新 ${result.updated} 个，跳过 ${result.skipped} 个，未找到 ${result.notFound} 个`,
    });

  } catch (error: any) {
    console.error('导入球队翻译失败:', error);

    // 清理临时文件
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.status(500).json({
      success: false,
      error: error.message || '导入球队翻译失败',
    });
  }
});

// GET /api/aliases/leagues/export-untranslated
router.get('/leagues/export-untranslated', ensureAdmin, async (req, res) => {
  try {
    console.log('📤 导出未翻译的联赛...');

    const leagues = await nameAliasService.getAllLeagues();
    const untranslated = leagues.filter(league => !league.name_zh_cn || league.name_zh_cn.trim() === '');

    if (untranslated.length === 0) {
      return res.status(404).json({
        success: false,
        error: '没有未翻译的联赛',
      });
    }

    // 创建 Excel 数据
    const data = untranslated.map(league => [
      league.name_en || '',
      '', // 空的简体中文列，等待填写
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Untranslated Leagues');

    // 生成 buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="leagues-untranslated-${Date.now()}.xlsx"`);
    res.send(buffer);

    console.log(`✅ 导出 ${untranslated.length} 个未翻译的联赛`);

  } catch (error: any) {
    console.error('导出未翻译联赛失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '导出失败',
    });
  }
});

// GET /api/aliases/teams/export-untranslated
router.get('/teams/export-untranslated', ensureAdmin, async (req, res) => {
  try {
    console.log('📤 导出未翻译的球队...');

    const teams = await nameAliasService.getAllTeams();
    const untranslated = teams.filter(team => !team.name_zh_cn || team.name_zh_cn.trim() === '');

    if (untranslated.length === 0) {
      return res.status(404).json({
        success: false,
        error: '没有未翻译的球队',
      });
    }

    // 创建 Excel 数据
    const data = untranslated.map(team => [
      team.name_en || '',
      '', // 空的简体中文列，等待填写
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Untranslated Teams');

    // 生成 buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="teams-untranslated-${Date.now()}.xlsx"`);
    res.send(buffer);

    console.log(`✅ 导出 ${untranslated.length} 个未翻译的球队`);

  } catch (error: any) {
    console.error('导出未翻译球队失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '导出失败',
    });
  }
});

/**
 * 从 iSports API 导入联赛和球队名称（仅导入有皇冠赔率的赛事）
 * POST /api/aliases/import-from-isports
 */
router.post('/import-from-isports', ensureAdmin, async (req, res) => {
  try {
    console.log('📥 开始从 iSports API 导入名称（仅有皇冠赔率的赛事）...');

    const isportsClient = new ISportsClient(
      process.env.ISPORTS_API_KEY || 'GvpziueL9ouzIJNj'
    );

    // 1. 获取今天的赛事（改为只获取1天）
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 获取日期: ${today}`);

    // 2. 获取今天的赛事
    let allMatches: any[] = [];
    try {
      allMatches = await isportsClient.getSchedule(today);
      console.log(`✅ 获取到 ${allMatches.length} 场比赛`);
    } catch (error: any) {
      console.error(`❌ 获取赛事失败:`, error);
      return res.status(500).json({
        success: false,
        error: `获取赛事失败: ${error.message}`,
      });
    }

    if (allMatches.length === 0) {
      console.log('⚠️  今天没有赛事');
      return res.json({
        success: true,
        data: {
          leagues: { total: 0, inserted: 0, updated: 0, skipped: 0 },
          teams: { total: 0, inserted: 0, updated: 0, skipped: 0 },
        },
        message: '今天没有赛事',
      });
    }

    // 3. 获取皇冠赔率（分批获取，每批50场）
    console.log('📥 获取皇冠赔率...');
    const matchIds = allMatches.map(m => m.matchId);
    const batchSize = 50;
    const allOdds = {
      handicap: [] as any[],
      europeOdds: [] as any[],
      overUnder: [] as any[],
    };

    for (let i = 0; i < matchIds.length; i += batchSize) {
      const batchIds = matchIds.slice(i, i + batchSize);
      try {
        console.log(`  📥 批次 ${Math.floor(i / batchSize) + 1}: 获取 ${batchIds.length} 场比赛的赔率...`);
        const oddsData = await isportsClient.getMainOdds(batchIds, ['3']); // companyId=3 是皇冠
        allOdds.handicap.push(...(oddsData.handicap || []));
        allOdds.europeOdds.push(...(oddsData.europeOdds || []));
        allOdds.overUnder.push(...(oddsData.overUnder || []));
        console.log(`  ✅ 批次 ${Math.floor(i / batchSize) + 1}: 成功`);
      } catch (error: any) {
        console.error(`  ❌ 批次 ${Math.floor(i / batchSize) + 1} 获取赔率失败:`, error.message);
      }
    }

    console.log(`✅ 获取到赔率: 让球盘 ${allOdds.handicap.length}, 独赢盘 ${allOdds.europeOdds.length}, 大小球 ${allOdds.overUnder.length}`);

    // 4. 筛选有皇冠赔率的赛事
    console.log('🔍 筛选有皇冠赔率的赛事...');
    const matchesWithCrownOdds = allMatches.filter(match => {
      const hasHandicap = allOdds.handicap.some(h => String(h.matchId) === String(match.matchId) && String(h.companyId) === '3');
      const hasEurope = allOdds.europeOdds.some(e => String(e.matchId) === String(match.matchId) && String(e.companyId) === '3');
      const hasOverUnder = allOdds.overUnder.some(o => String(o.matchId) === String(match.matchId) && String(o.companyId) === '3');
      return hasHandicap || hasEurope || hasOverUnder;
    });

    console.log(`✅ 筛选出 ${matchesWithCrownOdds.length} 场有皇冠赔率的赛事`);

    if (matchesWithCrownOdds.length === 0) {
      console.log('⚠️  今天没有皇冠赔率的赛事');
      return res.json({
        success: true,
        data: {
          leagues: { total: 0, inserted: 0, updated: 0, skipped: 0 },
          teams: { total: 0, inserted: 0, updated: 0, skipped: 0 },
        },
        message: '今天没有皇冠赔率的赛事',
      });
    }

    // 5. 提取唯一的联赛和球队（仅从有皇冠赔率的赛事中提取）
    console.log('📊 提取联赛和球队名称...');
    const leaguesMap = new Map<string, { id: string; name: string }>();
    const teamsMap = new Map<string, { id: string; name: string }>();

    for (const match of matchesWithCrownOdds) {
      // 联赛
      if (match.leagueId && match.leagueName) {
        leaguesMap.set(String(match.leagueId), {
          id: String(match.leagueId),
          name: match.leagueName,
        });
      }

      // 主队
      if (match.homeId && match.homeName) {
        teamsMap.set(String(match.homeId), {
          id: String(match.homeId),
          name: match.homeName,
        });
      }

      // 客队
      if (match.awayId && match.awayName) {
        teamsMap.set(String(match.awayId), {
          id: String(match.awayId),
          name: match.awayName,
        });
      }
    }

    const leagues = Array.from(leaguesMap.values());
    const teams = Array.from(teamsMap.values());

    console.log(`✅ 找到 ${leagues.length} 个联赛，${teams.length} 个球队（仅有皇冠赔率）`);

    // 6. 插入联赛（如果不存在）
    console.log('💾 插入联赛到数据库...');
    let leagueInserted = 0;
    let leagueUpdated = 0;
    let leagueSkipped = 0;

    for (const league of leagues) {
      try {
        console.log(`  处理联赛: ${league.name} (ID: ${league.id})`);

        // 检查是否已存在（通过 isports_league_id 或 name_en）
        const existing = await pool.query(
          'SELECT id, name_zh_tw, name_en, name_zh_cn FROM league_aliases WHERE isports_league_id = $1 OR name_en = $2',
          [league.id, league.name]
        );

        console.log(`    查询结果: ${existing.rows.length} 条记录`);

        if (existing.rows.length === 0) {
          // 插入新记录
          const canonicalKey = generateCanonicalKey('league', league.name);
          console.log(`    准备插入: isports_league_id=${league.id}, name=${league.name}, canonical_key=${canonicalKey}`);
          const insertResult = await pool.query(`
            INSERT INTO league_aliases (
              canonical_key,
              isports_league_id,
              name_zh_tw,
              name_en,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id
          `, [canonicalKey, league.id, league.name, league.name]);
          leagueInserted++;
          console.log(`    ✅ 新增联赛: ${league.name} (新ID: ${insertResult.rows[0].id})`);
        } else if (existing.rows.length === 1) {
          // 更新现有记录（如果名称为空）
          const row = existing.rows[0];
          console.log(`    已存在记录: id=${row.id}, name_zh_tw=${row.name_zh_tw}, name_en=${row.name_en}, name_zh_cn=${row.name_zh_cn}`);
          if (!row.name_zh_tw && !row.name_en) {
            await pool.query(`
              UPDATE league_aliases
              SET name_zh_tw = $1, name_en = $2, updated_at = NOW()
              WHERE id = $3
            `, [league.name, league.name, row.id]);
            leagueUpdated++;
            console.log(`    ✅ 更新联赛: ${league.name}`);
          } else {
            leagueSkipped++;
            console.log(`    ⏭️  跳过联赛: ${league.name} (已存在)`);
          }
        } else {
          // 发现多条记录，说明有重复数据
          leagueSkipped++;
          console.log(`    ⚠️  跳过联赛: ${league.name} (发现 ${existing.rows.length} 条重复记录，请先运行清理脚本)`);
        }
      } catch (error: any) {
        console.error(`❌ 处理联赛失败: ${league.name}`, error);
        console.error(`   错误详情:`, error.stack);
      }
    }

    console.log(`✅ 联赛处理完成: 新增 ${leagueInserted}, 更新 ${leagueUpdated}, 跳过 ${leagueSkipped}`);

    // 7. 插入球队（如果不存在）
    console.log('💾 插入球队到数据库...');
    let teamInserted = 0;
    let teamUpdated = 0;
    let teamSkipped = 0;

    for (const team of teams) {
      try {
        console.log(`  处理球队: ${team.name} (ID: ${team.id})`);

        // 检查是否已存在（通过 isports_team_id 或 name_en）
        const existing = await pool.query(
          'SELECT id, name_zh_tw, name_en, name_zh_cn FROM team_aliases WHERE isports_team_id = $1 OR name_en = $2',
          [team.id, team.name]
        );

        console.log(`    查询结果: ${existing.rows.length} 条记录`);

        if (existing.rows.length === 0) {
          // 插入新记录
          const canonicalKey = generateCanonicalKey('team', team.name);
          console.log(`    准备插入: isports_team_id=${team.id}, name=${team.name}, canonical_key=${canonicalKey}`);
          const insertResult = await pool.query(`
            INSERT INTO team_aliases (
              canonical_key,
              isports_team_id,
              name_zh_tw,
              name_en,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id
          `, [canonicalKey, team.id, team.name, team.name]);
          teamInserted++;
          console.log(`    ✅ 新增球队: ${team.name} (新ID: ${insertResult.rows[0].id})`);
        } else if (existing.rows.length === 1) {
          // 更新现有记录（如果名称为空）
          const row = existing.rows[0];
          console.log(`    已存在记录: id=${row.id}, name_zh_tw=${row.name_zh_tw}, name_en=${row.name_en}, name_zh_cn=${row.name_zh_cn}`);
          if (!row.name_zh_tw && !row.name_en) {
            await pool.query(`
              UPDATE team_aliases
              SET name_zh_tw = $1, name_en = $2, updated_at = NOW()
              WHERE id = $3
            `, [team.name, team.name, row.id]);
            teamUpdated++;
            console.log(`    ✅ 更新球队: ${team.name}`);
          } else {
            teamSkipped++;
            console.log(`    ⏭️  跳过球队: ${team.name} (已存在)`);
          }
        } else {
          // 发现多条记录，说明有重复数据
          teamSkipped++;
          console.log(`    ⚠️  跳过球队: ${team.name} (发现 ${existing.rows.length} 条重复记录，请先运行清理脚本)`);
        }
      } catch (error: any) {
        console.error(`❌ 处理球队失败: ${team.name}`, error);
        console.error(`   错误详情:`, error.stack);
      }
    }

    console.log(`✅ 球队处理完成: 新增 ${teamInserted}, 更新 ${teamUpdated}, 跳过 ${teamSkipped}`);

    console.log(`✅ 导入完成:`);
    console.log(`   联赛: ${leagueInserted} 新增 / ${leagueUpdated} 更新 / ${leagueSkipped} 跳过`);
    console.log(`   球队: ${teamInserted} 新增 / ${teamUpdated} 更新 / ${teamSkipped} 跳过`);

    res.json({
      success: true,
      data: {
        leagues: {
          total: leagues.length,
          inserted: leagueInserted,
          updated: leagueUpdated,
          skipped: leagueSkipped,
        },
        teams: {
          total: teams.length,
          inserted: teamInserted,
          updated: teamUpdated,
          skipped: teamSkipped,
        },
      },
    });
  } catch (error: any) {
    console.error('❌ 从 iSports API 导入失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '导入失败',
    });
  }
});

/**
 * 从皇冠赛事中导入联赛和球队名称
 * POST /api/aliases/import-from-crown
 */
router.post('/import-from-crown', ensureAdmin, async (req, res) => {
  try {
    console.log('📥 开始从皇冠赛事导入名称...');

    // 1. 从 crown_matches 表中获取所有唯一的联赛和球队名称
    const leaguesResult = await pool.query(`
      SELECT DISTINCT crown_league
      FROM crown_matches
      WHERE crown_league IS NOT NULL AND crown_league != ''
      ORDER BY crown_league
    `);

    const teamsResult = await pool.query(`
      SELECT DISTINCT name FROM (
        SELECT crown_home AS name FROM crown_matches WHERE crown_home IS NOT NULL AND crown_home != ''
        UNION
        SELECT crown_away AS name FROM crown_matches WHERE crown_away IS NOT NULL AND crown_away != ''
      ) AS teams
      ORDER BY name
    `);

    const leagues = leaguesResult.rows.map(r => r.crown_league);
    const teams = teamsResult.rows.map(r => r.name);

    console.log(`✅ 找到 ${leagues.length} 个联赛，${teams.length} 个球队`);

    // 2. 插入联赛（如果不存在）
    let leagueInserted = 0;
    let leagueSkipped = 0;

    for (const leagueName of leagues) {
      try {
        // 检查是否已存在
        const existing = await pool.query(
          'SELECT id FROM league_aliases WHERE name_crown_zh_cn = $1',
          [leagueName]
        );

        if (existing.rows.length === 0) {
          // 插入新记录
          const canonicalKey = generateCanonicalKey('league', leagueName);
          await pool.query(`
            INSERT INTO league_aliases (canonical_key, name_crown_zh_cn, created_at, updated_at)
            VALUES ($1, $2, NOW(), NOW())
          `, [canonicalKey, leagueName]);
          leagueInserted++;
        } else {
          leagueSkipped++;
        }
      } catch (error: any) {
        console.error(`❌ 插入联赛失败: ${leagueName}`, error.message);
      }
    }

    // 3. 插入球队（如果不存在）
    let teamInserted = 0;
    let teamSkipped = 0;

    for (const teamName of teams) {
      try {
        // 检查是否已存在
        const existing = await pool.query(
          'SELECT id FROM team_aliases WHERE name_crown_zh_cn = $1',
          [teamName]
        );

        if (existing.rows.length === 0) {
          // 插入新记录
          const canonicalKey = generateCanonicalKey('team', teamName);
          await pool.query(`
            INSERT INTO team_aliases (canonical_key, name_crown_zh_cn, created_at, updated_at)
            VALUES ($1, $2, NOW(), NOW())
          `, [canonicalKey, teamName]);
          teamInserted++;
        } else {
          teamSkipped++;
        }
      } catch (error: any) {
        console.error(`❌ 插入球队失败: ${teamName}`, error.message);
      }
    }

    console.log(`✅ 导入完成: 联赛 ${leagueInserted} 新增 / ${leagueSkipped} 跳过, 球队 ${teamInserted} 新增 / ${teamSkipped} 跳过`);

    res.json({
      success: true,
      data: {
        leagues: {
          total: leagues.length,
          inserted: leagueInserted,
          skipped: leagueSkipped,
        },
        teams: {
          total: teams.length,
          inserted: teamInserted,
          skipped: teamSkipped,
        },
      },
    });
  } catch (error: any) {
    console.error('❌ 从皇冠赛事导入失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '导入失败',
    });
  }
});

export { router as aliasRoutes };
