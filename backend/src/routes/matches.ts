import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { query } from '../models/database';
import { ApiResponse, Match } from '../types';

const router = Router();
router.use(authenticateToken);

// 获取比赛列表
router.get('/', async (req: any, res) => {
    try {
        const { status, league, limit = 50, offset = 0 } = req.query;

        let sql = 'SELECT * FROM matches WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;

        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }

        if (league) {
            sql += ` AND league_name ILIKE $${paramIndex++}`;
            params.push(`%${league}%`);
        }

        sql += ` ORDER BY match_time ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await query(sql, params);

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<Match[]>);

    } catch (error) {
        console.error('获取比赛列表错误:', error);
        res.status(500).json({
            success: false,
            error: '获取比赛列表失败'
        });
    }
});

// 获取单个比赛详情
router.get('/:id', async (req: any, res) => {
    try {
        const matchId = parseInt(req.params.id);

        const result = await query(
            'SELECT * FROM matches WHERE id = $1',
            [matchId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '比赛不存在'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        } as ApiResponse<Match>);

    } catch (error) {
        console.error('获取比赛详情错误:', error);
        res.status(500).json({
            success: false,
            error: '获取比赛详情失败'
        });
    }
});

// 获取热门比赛
router.get('/hot/list', async (req: any, res) => {
    try {
        const result = await query(`
            SELECT m.*, COUNT(b.id) as bet_count 
            FROM matches m 
            LEFT JOIN bets b ON m.id = b.match_id 
            WHERE m.status IN ('scheduled', 'live') 
            GROUP BY m.id 
            ORDER BY bet_count DESC, m.match_time ASC 
            LIMIT 20
        `);

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<Match[]>);

    } catch (error) {
        console.error('获取热门比赛错误:', error);
        res.status(500).json({
            success: false,
            error: '获取热门比赛失败'
        });
    }
});

// 搜索比赛
router.get('/search/:keyword', async (req: any, res) => {
    try {
        const keyword = req.params.keyword;
        const { limit = 20 } = req.query;

        const result = await query(`
            SELECT * FROM matches 
            WHERE (home_team ILIKE $1 OR away_team ILIKE $1 OR league_name ILIKE $1)
            AND status IN ('scheduled', 'live')
            ORDER BY match_time ASC 
            LIMIT $2
        `, [`%${keyword}%`, parseInt(limit)]);

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<Match[]>);

    } catch (error) {
        console.error('搜索比赛错误:', error);
        res.status(500).json({
            success: false,
            error: '搜索比赛失败'
        });
    }
});

export { router as matchRoutes };