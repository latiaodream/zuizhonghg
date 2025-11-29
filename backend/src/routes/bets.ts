import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { query } from '../models/database';
import { BetCreateRequest, ApiResponse, Bet, AccountSelectionEntry, CrownAccount } from '../types';
import { getCrownAutomation } from '../services/crown-automation';
import { selectAccounts } from '../services/account-selection';
import {
    parseLimitRange,
    parseIntervalRange,
    splitBetsForAccounts,
    generateBetQueue,
    generateRandomInterval,
} from '../utils/bet-splitter';

const buildExclusionReason = (entry?: AccountSelectionEntry | null): string => {
    if (!entry) {
        return '不符合优选条件';
    }

    const reasons: string[] = [];
    if (entry.flags.offline) {
        reasons.push('账号未在线');
    }
    if (entry.flags.stop_profit_reached) {
        reasons.push('已达到止盈金额');
    }
    if (entry.flags.line_conflicted) {
        reasons.push('同线路账号已下注该赛事');
    }

    return reasons.length > 0 ? reasons.join('、') : '不符合优选条件';
};

const router = Router();
router.use(authenticateToken);

// 获取下注统计数据（数据看板） - 必须在 GET / 之前
router.get('/stats', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { start_date, end_date, user_id, account_id, agent_id } = req.query as any;

        // 构建查询条件
        let sql = `
            SELECT
                COALESCE(SUM(bet_amount), 0) as total_bet_amount,
                COALESCE(SUM(CASE WHEN status != 'cancelled' THEN bet_amount ELSE 0 END), 0) as actual_amount,
                COALESCE(SUM(CASE WHEN status = 'settled' THEN profit_loss ELSE 0 END), 0) as actual_win_loss,
                COUNT(DISTINCT CASE WHEN status != 'cancelled' THEN id END) as total_tickets,
                COUNT(CASE WHEN status != 'cancelled' THEN 1 END) as total_bets,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as canceled_bets
            FROM bets
            WHERE 1=1
        `;
        const params: any[] = [];
        let paramIndex = 1;

        // 权限控制：管理员和代理可以查看子用户数据
        if (userRole === 'admin') {
            // 管理员：支持按 user_id 或 agent_id 过滤
            if (user_id) {
                sql += ` AND user_id = $${paramIndex++}`;
                params.push(parseInt(user_id));
            } else if (agent_id) {
                sql += ` AND user_id IN (SELECT id FROM users WHERE agent_id = $${paramIndex++})`;
                params.push(parseInt(agent_id));
            }
        } else if (userRole === 'agent') {
            // 代理：如果指定了user_id，只看该下级员工数据；否则看自己和所有下级数据
            if (user_id) {
                // 验证该用户是代理的下级
                sql += ` AND user_id = $${paramIndex++} AND user_id IN (
                    SELECT id FROM users WHERE agent_id = $${paramIndex++}
                )`;
                params.push(parseInt(user_id), userId);
            } else {
                // 看自己和所有下级的数据
                sql += ` AND (user_id = $${paramIndex++} OR user_id IN (
                    SELECT id FROM users WHERE agent_id = $${paramIndex++}
                ))`;
                params.push(userId, userId);
            }
        } else {
            // 普通员工：只能看自己的数据
            sql += ` AND user_id = $${paramIndex++}`;
            params.push(userId);
        }

        // 日期筛选
        if (start_date) {
            sql += ` AND DATE(created_at) >= $${paramIndex++}`;
            params.push(start_date);
        }

        if (end_date) {
            sql += ` AND DATE(created_at) <= $${paramIndex++}`;
            params.push(end_date);
        }

        // 账号筛选
        if (account_id) {
            sql += ` AND account_id = $${paramIndex++}`;
            params.push(parseInt(account_id));
        }

        const result = await query(sql, params);
        const stats = result.rows[0];

        res.json({
            success: true,
            data: {
                total_bet_amount: parseFloat(stats.total_bet_amount) || 0,
                actual_amount: parseFloat(stats.actual_amount) || 0,
                actual_win_loss: parseFloat(stats.actual_win_loss) || 0,
                total_tickets: parseInt(stats.total_tickets) || 0,
                total_bets: parseInt(stats.total_bets) || 0,
                canceled_bets: parseInt(stats.canceled_bets) || 0,
            }
        } as ApiResponse);

    } catch (error) {
        console.error('获取下注统计错误:', error);
        res.status(500).json({
            success: false,
            error: '获取下注统计失败'
        });
    }
});

// 获取下注记录(票单列表)
router.get('/', async (req: any, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const { status, date, account_id, limit = 50, offset = 0, user_id, agent_id } = req.query as any;

        let sql = `
            SELECT b.*, m.league_name, m.home_team, m.away_team, m.current_score,
                   ca.username AS account_username, ca.display_name AS account_display_name,
                   u.username AS user_username, u.username AS user_display_name
            FROM bets b
            JOIN matches m ON b.match_id = m.id
            JOIN crown_accounts ca ON b.account_id = ca.id
            JOIN users u ON b.user_id = u.id
            WHERE 1=1
        `;
        const params: any[] = [];
        let paramIndex = 1;

        // 角色范围过滤
        if (userRole === 'admin') {
            if (user_id) {
                sql += ` AND b.user_id = $${paramIndex++}`;
                params.push(parseInt(user_id));
            } else if (agent_id) {
                sql += ` AND b.user_id IN (SELECT id FROM users WHERE agent_id = $${paramIndex++})`;
                params.push(parseInt(agent_id));
            }
        } else if (userRole === 'agent') {
            if (user_id) {
                sql += ` AND b.user_id = $${paramIndex++} AND b.user_id IN (SELECT id FROM users WHERE agent_id = $${paramIndex++})`;
                params.push(parseInt(user_id), userId);
            } else {
                sql += ` AND (b.user_id = $${paramIndex++} OR b.user_id IN (SELECT id FROM users WHERE agent_id = $${paramIndex++}))`;
                params.push(userId, userId);
            }
        } else {
            sql += ` AND b.user_id = $${paramIndex++}`;
            params.push(userId);
        }

        if (status) {
            sql += ` AND b.status = $${paramIndex++}`;
            params.push(status);
        }

        if (date) {
            sql += ` AND DATE(b.created_at) = $${paramIndex++}`;
            params.push(date);
        }

        if (account_id) {
            sql += ` AND b.account_id = $${paramIndex++}`;
            params.push(account_id);
        }

        sql += ` ORDER BY b.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await query(sql, params);

        // 获取统计数据
        const statsResult = await query(`
            SELECT 
                COUNT(*) as total_bets,
                COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_bets,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bets,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bets,
                COALESCE(SUM(bet_amount), 0) as total_amount,
                COALESCE(SUM(profit_loss), 0) as total_profit_loss,
                COALESCE(SUM(payout), 0) as total_payout
            FROM bets WHERE 1=1
            ${userRole === 'admin' ? (user_id ? ' AND user_id = $1' : (agent_id ? ' AND user_id IN (SELECT id FROM users WHERE agent_id = $1)' : ''))
                : userRole === 'agent' ? (user_id ? ' AND user_id = $1 AND user_id IN (SELECT id FROM users WHERE agent_id = $2)' : ' AND (user_id = $1 OR user_id IN (SELECT id FROM users WHERE agent_id = $1))')
                : ' AND user_id = $1'}
        `, ((): any[] => {
            if (userRole === 'admin') {
                if (user_id) return [parseInt(user_id)];
                if (agent_id) return [parseInt(agent_id)];
                return [];
            }
            if (userRole === 'agent') {
                if (user_id) return [parseInt(user_id), userId];
                return [userId];
            }
            return [userId];
        })());

        const stats = statsResult.rows[0];
        const winRate = stats.settled_bets > 0 
            ? ((stats.total_profit_loss / stats.total_amount) * 100).toFixed(1)
            : '0';

        res.json({
            success: true,
            data: {
                bets: result.rows,
                stats: {
                    total_bets: parseInt(stats.total_bets),
                    settled_bets: parseInt(stats.settled_bets),
                    pending_bets: parseInt(stats.pending_bets),
                    cancelled_bets: parseInt(stats.cancelled_bets),
                    total_amount: parseFloat(stats.total_amount),
                    total_profit_loss: parseFloat(stats.total_profit_loss),
                    total_payout: parseFloat(stats.total_payout),
                    win_rate: `${winRate}%`
                }
            }
        } as ApiResponse);

    } catch (error: any) {
        console.error('获取下注记录错误:', error);
        console.error('错误详情:', {
            message: error?.message,
            stack: error?.stack,
            userId,
            userRole,
            query: req.query
        });
        res.status(500).json({
            success: false,
            error: '获取下注记录失败',
            details: error?.message
        });
    }
});

// 创建下注记录(批量下注)
router.post('/', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const agentId = req.user.agent_id; // 获取代理ID，用于金币扣费
        const betData: BetCreateRequest = req.body;

        console.log('📝 收到下注请求:', JSON.stringify(betData, null, 2));

        if (!betData.account_ids || betData.account_ids.length === 0) {
            console.log('❌ 验证失败: 未选择账号');
            return res.status(400).json({
                success: false,
                error: '请选择下注账号'
            });
        }

        const hasMatchIdentifier = (
            (typeof betData.match_id === 'number' && Number.isFinite(betData.match_id)) ||
            (typeof betData.crown_match_id === 'string' && betData.crown_match_id.trim().length > 0)
        );

        if (!hasMatchIdentifier || !betData.bet_type || !betData.total_amount) {
            console.log('❌ 验证失败: 缺少必填字段', {
                match_id: betData.match_id,
                crown_match_id: betData.crown_match_id,
                bet_type: betData.bet_type,
                total_amount: betData.total_amount
            });
            return res.status(400).json({
                success: false,
                error: '比赛信息、下注类型和总金额不能为空'
            });
        }

        if (betData.total_amount <= 0) {
            return res.status(400).json({
                success: false,
                error: '总金额必须大于 0'
            });
        }

        // 检查金币余额是否足够
        const chargeUserId = (userRole === 'staff' && agentId) ? agentId : userId;
        const coinBalanceResult = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [chargeUserId]
        );
        const coinBalance = parseFloat(coinBalanceResult.rows[0].balance);
        if (coinBalance < betData.total_amount) {
            console.log('❌ 金币余额不足:', { coinBalance, required: betData.total_amount, chargeUserId });
            return res.status(400).json({
                success: false,
                error: `金币余额不足，当前余额: ${coinBalance.toFixed(2)}，需要: ${betData.total_amount}`
            });
        }

        let crownMatchIdRaw = (betData.crown_match_id || '').toString().trim();
        let crownMatchId = crownMatchIdRaw || (
            typeof betData.match_id === 'number' && Number.isFinite(betData.match_id)
                ? String(betData.match_id)
                : undefined
        );

        // 如果没有 crown_match_id，尝试通过联赛、球队名称和时间模糊匹配
        if (!crownMatchId && betData.home_team && betData.away_team) {
            console.log('⚠️ 缺少 crown_match_id，尝试通过模糊匹配查询...');
            console.log('   联赛:', betData.league_name);
            console.log('   主队:', betData.home_team);
            console.log('   客队:', betData.away_team);
            console.log('   时间:', betData.match_time);

            try {
                // 构建查询条件
                const conditions: string[] = [];
                const params: any[] = [];
                let paramIndex = 1;

                // 球队名称模糊匹配（必须）
                conditions.push(`crown_home ILIKE $${paramIndex++}`);
                params.push(`%${betData.home_team}%`);

                conditions.push(`crown_away ILIKE $${paramIndex++}`);
                params.push(`%${betData.away_team}%`);

                // 联赛名称模糊匹配（如果有）
                if (betData.league_name) {
                    conditions.push(`crown_league ILIKE $${paramIndex++}`);
                    params.push(`%${betData.league_name}%`);
                }

                // 时间范围匹配（如果有）：前后 6 小时
                if (betData.match_time) {
                    const matchTime = new Date(betData.match_time);
                    if (Number.isFinite(matchTime.getTime())) {
                        const timeBefore = new Date(matchTime.getTime() - 6 * 60 * 60 * 1000);
                        const timeAfter = new Date(matchTime.getTime() + 6 * 60 * 60 * 1000);
                        conditions.push(`match_time BETWEEN $${paramIndex++} AND $${paramIndex++}`);
                        params.push(timeBefore, timeAfter);
                    }
                }

                const whereClause = conditions.join(' AND ');
                const sql = `
                    SELECT crown_gid, crown_league, crown_home, crown_away, match_time
                    FROM crown_matches
                    WHERE ${whereClause}
                    ORDER BY created_at DESC
                    LIMIT 10
                `;

                console.log('🔍 执行模糊匹配查询:', sql);
                console.log('   参数:', params);

                const crownMatchResult = await query(sql, params);

                if (crownMatchResult.rows.length > 0) {
                    // 使用简单的字符串相似度算法（Levenshtein 距离）进行排序
                    const calculateSimilarity = (str1: string, str2: string): number => {
                        const len1 = str1.length;
                        const len2 = str2.length;
                        const matrix: number[][] = [];

                        for (let i = 0; i <= len1; i++) {
                            matrix[i] = [i];
                        }
                        for (let j = 0; j <= len2; j++) {
                            matrix[0][j] = j;
                        }

                        for (let i = 1; i <= len1; i++) {
                            for (let j = 1; j <= len2; j++) {
                                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                                matrix[i][j] = Math.min(
                                    matrix[i - 1][j] + 1,
                                    matrix[i][j - 1] + 1,
                                    matrix[i - 1][j - 1] + cost
                                );
                            }
                        }

                        const distance = matrix[len1][len2];
                        const maxLen = Math.max(len1, len2);
                        return maxLen === 0 ? 1 : 1 - distance / maxLen;
                    };

                    // 计算每个结果的相似度评分
                    const scoredResults = crownMatchResult.rows.map((row: any) => {
                        const homeScore = calculateSimilarity((betData.home_team || '').toLowerCase(), row.crown_home.toLowerCase());
                        const awayScore = calculateSimilarity((betData.away_team || '').toLowerCase(), row.crown_away.toLowerCase());
                        const totalScore = homeScore + awayScore;
                        return { ...row, score: totalScore };
                    });

                    // 按相似度排序
                    scoredResults.sort((a, b) => b.score - a.score);

                    const bestMatch = scoredResults[0];
                    crownMatchId = bestMatch.crown_gid;
                    console.log('✅ 通过模糊匹配找到皇冠 GID:', crownMatchId);
                    console.log('   匹配结果:', {
                        crown_gid: bestMatch.crown_gid,
                        crown_league: bestMatch.crown_league,
                        crown_home: bestMatch.crown_home,
                        crown_away: bestMatch.crown_away,
                        match_time: bestMatch.match_time,
                        score: bestMatch.score.toFixed(3),
                    });

                    // 如果有多个结果，显示其他候选
                    if (scoredResults.length > 1) {
                        console.log('   其他候选:');
                        scoredResults.slice(1, 5).forEach((row: any, idx: number) => {
                            console.log(`   ${idx + 2}. ${row.crown_home} vs ${row.crown_away} (${row.crown_gid}, score: ${row.score.toFixed(3)})`);
                        });
                    }
                } else {
                    console.log('⚠️ 未找到匹配的皇冠比赛');
                }
            } catch (error) {
                console.error('❌ 查询皇冠比赛失败:', error);
            }
        }

        let matchRecord: any | undefined;
        let matchDbId: number | undefined = undefined;

        if (typeof betData.match_id === 'number' && Number.isFinite(betData.match_id)) {
            const matchById = await query('SELECT * FROM matches WHERE id = $1', [betData.match_id]);
            if (matchById.rows.length > 0) {
                matchRecord = matchById.rows[0];
                matchDbId = matchRecord.id;
            }
        }

        if (!matchRecord && crownMatchId) {
            const matchByCrown = await query('SELECT * FROM matches WHERE match_id = $1', [crownMatchId]);
            if (matchByCrown.rows.length > 0) {
                matchRecord = matchByCrown.rows[0];
                matchDbId = matchRecord.id;
            }
        }

        if (!matchRecord) {
            if (!betData.league_name || !betData.home_team || !betData.away_team) {
                return res.status(400).json({
                    success: false,
                    error: '比赛不存在且缺少创建比赛所需的信息'
                });
            }

            const matchTime = betData.match_time ? new Date(betData.match_time) : new Date();
            const safeMatchTime = Number.isFinite(matchTime.getTime()) ? matchTime : new Date();

            const insertResult = await query(`
                INSERT INTO matches (
                    match_id, league_name, home_team, away_team, match_time, status, current_score, match_period
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [
                crownMatchId || `auto-${Date.now()}`,
                betData.league_name,
                betData.home_team,
                betData.away_team,
                safeMatchTime,
                betData.match_status || 'scheduled',
                betData.current_score || null,
                betData.match_period || null,
            ]);

            matchRecord = insertResult.rows[0];
            matchDbId = matchRecord.id;
        }

        if (!matchDbId) {
            return res.status(400).json({
                success: false,
                error: '无法确定比赛信息'
            });
        }

        betData.match_id = matchDbId;
        const resolvedCrownMatchId = matchRecord.match_id || crownMatchId;

        // 验证账号归属范围，并记录账号所属用户
        let ownershipSql = `
            SELECT id, user_id
            FROM crown_accounts
            WHERE id = ANY($1) AND is_enabled = true
        `;
        const ownershipParams: any[] = [betData.account_ids];
        if (userRole === 'admin') {
            // 管理员：允许操作任意启用账号
        } else if (userRole === 'agent') {
            ownershipSql += ` AND (user_id = $2 OR user_id IN (SELECT id FROM users WHERE agent_id = $2))`;
            ownershipParams.push(userId);
        } else {
            ownershipSql += ` AND user_id = $2`;
            ownershipParams.push(userId);
        }
        const ownershipResult = await query(ownershipSql, ownershipParams);

        if (ownershipResult.rows.length !== betData.account_ids.length) {
            return res.status(400).json({
                success: false,
                error: '部分账号不存在或已禁用'
            });
        }

        const eligibleMap = new Map<number, AccountSelectionEntry>();
        const excludedMap = new Map<number, AccountSelectionEntry>();

        // 使用当前用户的权限查询账号状态
        const selection = await selectAccounts({
            userId,
            userRole,
            agentId,
            matchId: betData.match_id,
        });

        selection.eligible_accounts.forEach((entry) => {
            eligibleMap.set(entry.account.id, entry);
        });

        selection.excluded_accounts.forEach((entry) => {
            excludedMap.set(entry.account.id, entry);
        });

        const invalidAccounts: Array<{ id: number; reason: string }> = [];
        const usedLineKeys = new Set<string>();
        const validatedAccountIds: number[] = [];

        for (const accId of betData.account_ids) {
            const entry = eligibleMap.get(accId);
            if (!entry) {
                const reason = buildExclusionReason(excludedMap.get(accId));
                invalidAccounts.push({ id: accId, reason });
                continue;
            }

            const lineKey = entry.account.line_key;
            if (usedLineKeys.has(lineKey)) {
                invalidAccounts.push({
                    id: accId,
                    reason: `与其他所选账号属于同一线路 (${lineKey})，同场仅允许一次下注`,
                });
                continue;
            }

            usedLineKeys.add(lineKey);
            validatedAccountIds.push(accId);
        }

        if (invalidAccounts.length > 0) {
            const detail = invalidAccounts
                .map((item) => `账号 ${item.id}: ${item.reason}`)
                .join('；');
            return res.status(400).json({
                success: false,
                error: `部分账号无法下注：${detail}`,
            });
        }

        if (validatedAccountIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: '暂无符合条件的账号可下注',
            });
        }

        // 根据 quantity 参数确定实际使用的账号数量
        const quantity = betData.quantity || validatedAccountIds.length;
        const actualAccountIds = validatedAccountIds.slice(0, Math.min(quantity, validatedAccountIds.length));

        console.log(`📊 下注参数: 总金额=${betData.total_amount}, 账号数=${actualAccountIds.length}, 单笔限额=${betData.single_limit || '自动'}, 间隔=${betData.interval_range || '无'}`);

        // 获取账号信息（折扣、限额）
        const accountsResult = await query(
            'SELECT id, discount, football_prematch_limit, football_live_limit FROM crown_accounts WHERE id = ANY($1)',
            [actualAccountIds]
        );

        const accountDiscounts = new Map<number, number>();
        const accountLimits = new Map<number, { min: number; max: number }>();

        for (const row of accountsResult.rows) {
            const accountId = Number(row.id);
            const discount = Number(row.discount) || 1.0;
            accountDiscounts.set(accountId, discount);

            // 使用账号的限额（如果有）
            const limit = Number(row.football_prematch_limit) || Number(row.football_live_limit) || 0;
            if (limit > 0) {
                accountLimits.set(accountId, { min: 50, max: limit });
            }
        }

        // 解析单笔限额范围
        const singleLimitRange = parseLimitRange(betData.single_limit);

        console.log('🔍 拆分参数:', {
            total_amount: betData.total_amount,
            single_limit: betData.single_limit,
            parsed_limit_range: singleLimitRange,
            account_count: actualAccountIds.length,
            account_discounts: Array.from(accountDiscounts.entries()),
            account_limits: Array.from(accountLimits.entries()),
        });

        // 拆分金额
        let betSplits;
        try {
            betSplits = splitBetsForAccounts({
                totalRealAmount: betData.total_amount,
                accountIds: actualAccountIds,
                accountDiscounts,
                singleLimitRange: singleLimitRange || undefined,
                accountLimits: singleLimitRange ? undefined : accountLimits,
            });
        } catch (error: any) {
            return res.status(400).json({
                success: false,
                error: `金额拆分失败: ${error.message}`,
            });
        }

        // 生成轮流下注队列
        const betQueue = generateBetQueue(betSplits);

        console.log(`📋 生成下注队列: 共 ${betQueue.length} 笔`);
        betQueue.forEach((split, index) => {
            console.log(`  ${index + 1}. 账号 ${split.accountId}: 虚数 ${split.virtualAmount}, 实数 ${split.realAmount.toFixed(2)}, 折扣 ${split.discount}`);
        });

        // 解析间隔时间范围
        const intervalRange = parseIntervalRange(betData.interval_range);

        const automation = getCrownAutomation();
        const createdBets: Array<{ record: any; crown_result: any; accountId: number; match: any }> = [];
        const verifiableBets: Array<{ record: any; crown_result: any; accountId: number; match: any }> = [];
        const failedBets: Array<{ accountId: number; error: string }> = [];
        const verificationWarnings: Array<{ accountId: number; warning: string }> = [];

        // 按队列执行下注
        for (let i = 0; i < betQueue.length; i++) {
            const split = betQueue[i];
            const accountId = split.accountId;
            const crownAmount = split.virtualAmount;  // 虚数金额
            const platformAmount = split.realAmount;  // 实数金额
            const discount = split.discount;

            console.log(`\n🎯 执行第 ${i + 1}/${betQueue.length} 笔下注: 账号 ${accountId}, 虚数 ${crownAmount}, 实数 ${platformAmount.toFixed(2)}`);

            try {
                // 获取账号完整信息（用于自动登录）
                const accountResult = await query(
                    'SELECT * FROM crown_accounts WHERE id = $1',
                    [accountId]
                );

                if (accountResult.rows.length === 0) {
                    failedBets.push({
                        accountId,
                        error: '账号不存在或已被删除',
                    });
                    continue;
                }

                const accountRow = accountResult.rows[0] as CrownAccount;

                // 确保账号会话可用，必要时自动登录
                if (!automation.isAccountOnline(accountId)) {
                    console.log(`🔐 账号 ${accountId} 未登录，尝试自动登录...`);
                    const loginAttempt = await automation.loginAccountWithApi(accountRow);
                    if (!loginAttempt.success) {
                        failedBets.push({
                            accountId,
                            error: loginAttempt.message || '账号登录失败',
                        });

                        await query(
                            `UPDATE crown_accounts
                             SET is_online = false,
                                 status = 'error',
                                 error_message = $2,
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $1`,
                            [accountId, (loginAttempt.message || '登录失败').slice(0, 255)]
                        ).catch((err) => {
                            console.warn('⚠️ 更新账号状态失败:', err);
                        });

                        continue;
                    }
                }

                // 检查最低赔率
                const minOddsThreshold = Number(betData.min_odds);
                if (Number.isFinite(minOddsThreshold) && minOddsThreshold > 0) {
                    const compareOdds = Number(betData.odds);
                    if (!Number.isFinite(compareOdds) || compareOdds < minOddsThreshold) {
                        failedBets.push({
                            accountId,
                            error: `实时赔率 ${Number.isFinite(compareOdds) ? compareOdds.toFixed(3) : '--'} 低于最低赔率 ${minOddsThreshold}`,
                        });
                        continue;
                    }
                }

                // 调用真实的Crown下注API
                const betResult = await automation.placeBet(accountId, {
                    betType: betData.bet_type,
                    betOption: betData.bet_option,
                    amount: crownAmount,
                    odds: betData.odds,
                    platformAmount,
                    discount,
                    match_id: betData.match_id,
                    matchId: betData.match_id,
                    crown_match_id: resolvedCrownMatchId,
                    crownMatchId: resolvedCrownMatchId,
                    league_name: betData.league_name || matchRecord.league_name,
                    leagueName: betData.league_name || matchRecord.league_name,
                    home_team: betData.home_team || matchRecord.home_team,
                    homeTeam: betData.home_team || matchRecord.home_team,
                    away_team: betData.away_team || matchRecord.away_team,
                    awayTeam: betData.away_team || matchRecord.away_team,
                    market_category: betData.market_category,
                    marketCategory: betData.market_category,
                    market_scope: betData.market_scope,
                    marketScope: betData.market_scope,
                    market_side: betData.market_side,
                    marketSide: betData.market_side,
                    market_line: betData.market_line,
                    marketLine: betData.market_line,
                    market_index: betData.market_index,
                    marketIndex: betData.market_index,
                    market_wtype: betData.market_wtype,
                    marketWtype: betData.market_wtype,
                    market_rtype: betData.market_rtype,
                    marketRtype: betData.market_rtype,
                    market_chose_team: betData.market_chose_team,
                    marketChoseTeam: betData.market_chose_team,
                    spread_gid: betData.spread_gid,  // 盘口专属 gid
                    spreadGid: betData.spread_gid,
                });

                // 创建数据库记录
                const initialStatus = betResult.success ? 'confirmed' : 'cancelled';
                // 下注失败时记录失败原因，写入 bets.error_message 方便后续排查
                const errorMessage = betResult.success ? null : (betResult.message || '下注失败');
                if (!betResult.success && errorMessage) {
                    console.warn(`账号 ${accountId} 下注返回失败: ${errorMessage}`);
                }

                const finalOddsValue = betResult.actualOdds || betData.odds;

                const insertResult = await query(`
                    INSERT INTO bets (
                        user_id, account_id, match_id, bet_type, bet_option, bet_amount, virtual_bet_amount, odds,
                        market_category, market_scope, market_side, market_line, market_index,
                        single_limit, interval_seconds, quantity, status, official_bet_id, official_odds, score, error_message
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                    RETURNING *
                `, [
                    userId,
                    accountId,
                    betData.match_id,
                    betData.bet_type,
                    betData.bet_option,
                    platformAmount,  // 实数金额（平台实际扣费）
                    crownAmount,     // 虚数金额（皇冠下注金额）
                    finalOddsValue,
                    betData.market_category || null,
                    betData.market_scope || null,
                    betData.market_side || null,
                    betData.market_line || null,
                    Number.isFinite(betData.market_index) ? Number(betData.market_index) : null,
                    betData.single_limit || null,
                    intervalRange ? Math.round((intervalRange.min + intervalRange.max) / 2) : 3,  // 存储平均值
                    betData.quantity || actualAccountIds.length,
                    initialStatus,
                    betResult.betId || null,
                    finalOddsValue,
                    betData.current_score || matchRecord.current_score || null,
                    errorMessage
                ]);

                const createdRecord = insertResult.rows[0];

                const payload = {
                    record: createdRecord,
                    crown_result: betResult,
                    accountId,
                    match: matchRecord,
                };

                createdBets.push(payload);

                if (betResult.success) {
                    verifiableBets.push(payload);
                } else {
                failedBets.push({
                    accountId,
                    error: betResult.message || '下注失败',
                });
                }

                // 创建金币流水记录(消耗) - 仅当下注成功时
                // 金币从代理账户扣除（如果是员工下注）或从自己账户扣除（如果是代理下注）
                if (betResult.success) {
                    const transactionId = `BET${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

                    // 确定扣费用户：员工下注扣代理金币，代理下注扣自己金币
                    const chargeUserId = (userRole === 'staff' && agentId) ? agentId : userId;

                    // 获取当前余额
                    const balanceResult = await query(
                        'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
                        [chargeUserId]
                    );
                    const currentBalance = parseFloat(balanceResult.rows[0].balance);

                    await query(`
                        INSERT INTO coin_transactions (
                            user_id, account_id, bet_id, transaction_id, transaction_type,
                            description, amount, balance_before, balance_after
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, [
                        chargeUserId,  // 扣代理的金币（如果是员工）或自己的金币（如果是代理）
                        accountId,
                        createdRecord.id,
                        transactionId,
                        '消耗',
                        `下注消耗 - ${betData.bet_type} ${betData.bet_option}${userRole === 'staff' ? ` (员工: ${req.user.username})` : ''}`,
                        -platformAmount,
                        currentBalance,
                        currentBalance - platformAmount
                    ]);
                }
            } catch (accountError: any) {
                console.error(`账号 ${accountId} 下注失败:`, accountError);
                failedBets.push({
                    accountId,
                    error: accountError.message || '下注失败'
                });
            }

            // 如果不是最后一笔，等待随机间隔时间
            if (i < betQueue.length - 1 && intervalRange) {
                const waitSeconds = generateRandomInterval(intervalRange);
                console.log(`⏳ 等待 ${waitSeconds.toFixed(1)} 秒后执行下一笔...`);
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            }
        }

        for (const created of verifiableBets) {
            const betRecord = created.record;
            const betResult = created.crown_result;
            const matchInfo = created.match || {};

            if (!automation.isAccountOnline(created.accountId)) {
                verificationWarnings.push({
                    accountId: created.accountId,
                    warning: '下注完成后账号离线，无法匹配官网注单'
                });
                continue;
            }

            let matchedWager: any = null;
            const maxAttempts = 3;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const wagers = await automation.fetchTodayWagers(created.accountId).catch(() => null);

                if (wagers && wagers.length > 0) {
                    matchedWager = betResult.betId
                        ? wagers.find((item: any) => item.ticketId === betResult.betId) || null
                        : null;

                    if (!matchedWager) {
                        matchedWager = automation.findMatchingWager(
                            wagers,
                            matchInfo.league_name || matchInfo.leagueName || null,
                            matchInfo.home_team || matchInfo.homeTeam || null,
                            matchInfo.away_team || matchInfo.awayTeam || null,
                        );
                    }
                }

                if (matchedWager) {
                    break;
                }

                if (attempt < maxAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, 600));
                }
            }

            if (!matchedWager) {
                const reason = betResult.message || '官网未找到对应注单';
                verificationWarnings.push({
                    accountId: created.accountId,
                    warning: reason
                });
                continue;
            }

            const ticketId = String(matchedWager.ticketId || '').trim();
            if (!ticketId) {
                verificationWarnings.push({
                    accountId: created.accountId,
                    warning: '官网注单号为空'
                });
                continue;
            }

            await query(`
                UPDATE bets SET
                    status = 'confirmed',
                    official_bet_id = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [ticketId, betRecord.id]);

            created.record = {
                ...betRecord,
                status: 'confirmed',
                official_bet_id: ticketId,
            };
        }

        const totalRequested = validatedAccountIds.length;
        const successCount = createdBets.filter(entry => entry.record.status === 'confirmed').length;
        const failCount = failedBets.length;

        res.status(successCount > 0 ? 201 : 400).json({
            success: successCount > 0,
            data: {
                bets: createdBets.map(entry => ({
                    ...entry.record,
                    crown_result: entry.crown_result,
                })),
                failed: failedBets,
                warnings: verificationWarnings,
                stats: {
                    total: totalRequested,
                    success: successCount,
                    failed: failCount
                }
            },
            message: successCount > 0
                ? `成功下注 ${successCount}/${totalRequested} 个账号${failCount > 0 ? `，${failCount} 个失败` : ''}`
                : `全部下注失败 (${failCount}/${totalRequested})`
        } as ApiResponse);

    } catch (error) {
        console.error('创建下注记录错误:', error);
        res.status(500).json({
            success: false,
            error: '创建下注记录失败'
        });
    }
});

// 同步结算结果
router.post('/sync-settlements', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const accountIdsRaw = Array.isArray(req.body?.account_ids) ? req.body.account_ids : undefined;
        const accountIds = accountIdsRaw
            ? accountIdsRaw
                .map((id: any) => Number(id))
                .filter((id: number) => Number.isInteger(id))
            : undefined;

        const params: any[] = [];
        let sql = `
            SELECT b.*, ca.discount
            FROM bets b
            JOIN crown_accounts ca ON ca.id = b.account_id
            WHERE 1=1
              AND b.status IN ('confirmed', 'pending')
              AND b.official_bet_id IS NOT NULL
        `;
        if (userRole === 'admin') {
            // no additional filter
        } else if (userRole === 'agent') {
            sql += ` AND (b.user_id = $${params.length + 1} OR b.user_id IN (SELECT id FROM users WHERE agent_id = $${params.length + 1}))`;
            params.push(userId);
        } else {
            sql += ` AND b.user_id = $${params.length + 1}`;
            params.push(userId);
        }
        if (accountIds && accountIds.length > 0) {
            sql += ` AND b.account_id = ANY($${params.length + 1})`;
            params.push(accountIds);
        }
        sql += ' ORDER BY b.created_at ASC';

        const pendingResult = await query(sql, params);
        const pendingBets = pendingResult.rows;

        if (pendingBets.length === 0) {
            return res.json({
                success: true,
                message: '暂无需要同步的注单',
                data: {
                    updated_bets: [],
                    errors: [],
                    skipped: []
                }
            } as ApiResponse);
        }

        const roundTo = (value: number, digits = 2) => {
            const factor = Math.pow(10, digits);
            return Math.round(value * factor) / factor;
        };

        const parseAmount = (value?: string | null): number | null => {
            if (!value) {
                return null;
            }
            const cleaned = value.replace(/[^0-9.\-]/g, '');
            if (!cleaned) {
                return null;
            }
            const num = parseFloat(cleaned);
            return Number.isFinite(num) ? num : null;
        };

        const groupByAccount = new Map<number, any[]>();
        for (const bet of pendingBets) {
            const accId = Number(bet.account_id);
            if (!groupByAccount.has(accId)) {
                groupByAccount.set(accId, []);
            }
            groupByAccount.get(accId)!.push(bet);
        }

        const automation = getCrownAutomation();
        const updatedBets: Array<{ id: number; ticketId: string; status: string; result: string; payout: number; profit_loss: number }>
            = [];
        const errors: Array<{ accountId: number; error: string }> = [];
        const skipped: Array<{ betId: number; reason: string }> = [];

        for (const [accountId, bets] of groupByAccount.entries()) {
            if (!automation.isAccountOnline(accountId)) {
                errors.push({ accountId, error: '账号未登录' });
                continue;
            }

            let wagers;
            try {
                wagers = await automation.fetchTodayWagers(accountId);
            } catch (fetchError: any) {
                errors.push({
                    accountId,
                    error: fetchError instanceof Error ? fetchError.message : String(fetchError)
                });
                continue;
            }

            const wagerMap = new Map<string, any>();
            for (const item of wagers) {
                if (item.ticketId) {
                    wagerMap.set(String(item.ticketId), item);
                }
            }

            for (const bet of bets) {
                const ticketIdRaw = bet.official_bet_id ? String(bet.official_bet_id) : '';
                if (!ticketIdRaw) {
                    skipped.push({ betId: bet.id, reason: '缺少官网注单号' });
                    continue;
                }

                const wager = wagerMap.get(ticketIdRaw);
                if (!wager) {
                    skipped.push({ betId: bet.id, reason: '官网未找到对应注单' });
                    continue;
                }

                const winGoldStr = (wager.winGold || '').trim();
                if (!winGoldStr || !/[0-9]/.test(winGoldStr)) {
                    // 官网仍未结算
                    continue;
                }

                const crownStake = parseAmount(wager.gold);
                const crownProfit = parseAmount(winGoldStr);

                if (crownStake === null || crownProfit === null) {
                    skipped.push({ betId: bet.id, reason: '官网注单金额解析失败' });
                    continue;
                }

                const discount = Number(bet.discount) || 1;
                const platformStakeRecorded = Number(bet.bet_amount) || 0;
                const platformStakeFromCrown = roundTo(crownStake * discount, 2);
                let profitLoss = roundTo(crownProfit * discount, 2);

                const effectiveStake = platformStakeRecorded > 0
                    ? roundTo(platformStakeRecorded, 2)
                    : platformStakeFromCrown;

                const normalizedText = `${wager.ballActRet || ''} ${wager.resultText || ''}`.toLowerCase();
                const isCancelled = /取消|void|無效|无效/.test(normalizedText);

                const tolerance = 0.01;
                let payout: number;
                let result: 'win' | 'lose' | 'draw' | 'cancelled';
                let status: 'settled' | 'cancelled' = 'settled';

                if (profitLoss > tolerance) {
                    result = 'win';
                    payout = roundTo(effectiveStake + profitLoss, 2);
                } else if (profitLoss < -tolerance) {
                    result = 'lose';
                    payout = 0;
                } else {
                    profitLoss = 0;
                    if (isCancelled) {
                        result = 'cancelled';
                        status = 'cancelled';
                    } else {
                        result = 'draw';
                    }
                    payout = roundTo(effectiveStake, 2);
                }

                const updateResult = await query(`
                    UPDATE bets SET
                        status = $1,
                        result = $2,
                        payout = $3,
                        profit_loss = $4,
                        settled_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $5 AND user_id = $6
                    RETURNING id
                `, [status, result, payout, profitLoss, bet.id, userId]);

                if (updateResult.rows.length === 0) {
                    skipped.push({ betId: bet.id, reason: '更新注单失败' });
                    continue;
                }

                if (payout > 0) {
                    const existingRefund = await query(
                        `SELECT id FROM coin_transactions WHERE bet_id = $1 AND transaction_type = '返还' LIMIT 1`,
                        [bet.id]
                    );

                    if (existingRefund.rows.length === 0) {
                        const transactionId = `PAYOUT${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
                        const balanceBeforeResult = await query(
                            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
                            [userId]
                        );
                        const balanceBefore = parseFloat(balanceBeforeResult.rows[0]?.balance || '0');
                        const balanceAfter = roundTo(balanceBefore + payout, 2);

                        await query(`
                            INSERT INTO coin_transactions (
                                user_id, account_id, bet_id, transaction_id, transaction_type,
                                description, amount, balance_before, balance_after
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        `, [
                            userId,
                            bet.account_id,
                            bet.id,
                            transactionId,
                            '返还',
                            `下注派彩 - ${bet.bet_type} ${bet.bet_option}`,
                            payout,
                            balanceBefore,
                            balanceAfter
                        ]);
                    }
                }

                updatedBets.push({
                    id: bet.id,
                    ticketId: ticketIdRaw,
                    status,
                    result,
                    payout,
                    profit_loss: profitLoss
                });
            }
        }

        res.json({
            success: true,
            message: `同步完成，更新 ${updatedBets.length} 条注单`,
            data: {
                updated_bets: updatedBets,
                errors,
                skipped
            }
        } as ApiResponse);

    } catch (error) {
        console.error('同步注单结算失败:', error);
        res.status(500).json({
            success: false,
            error: '同步下注结算失败'
        } as ApiResponse);
    }
});

// 更新下注状态
router.put('/:id/status', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const betId = parseInt(req.params.id);
        const { status, result, payout, official_bet_id } = req.body;

        // 检查下注记录是否属于当前用户
        const betCheck = await query(
            'SELECT * FROM bets WHERE id = $1 AND user_id = $2',
            [betId, userId]
        );

        if (betCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '下注记录不存在'
            });
        }

        const bet = betCheck.rows[0];
        let profitLoss = 0;

        if (status === 'settled' && payout) {
            profitLoss = payout - bet.bet_amount;
        }

        const updateResult = await query(`
            UPDATE bets SET
                status = $1,
                result = $2,
                payout = $3,
                profit_loss = $4,
                official_bet_id = $5,
                confirmed_at = CASE WHEN $1 = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
                settled_at = CASE WHEN $1 = 'settled' THEN CURRENT_TIMESTAMP ELSE settled_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6 AND user_id = $7
            RETURNING *
        `, [status, result, payout || 0, profitLoss, official_bet_id, betId, userId]);

        // 如果是结算且有派彩，创建返还流水
        // 派彩返还到代理账户（如果是员工下注）或自己账户（如果是代理下注）
        if (status === 'settled' && payout > 0) {
            const transactionId = `PAYOUT${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

            // 查询下注用户的角色和代理ID
            const userInfo = await query(
                'SELECT role, agent_id, username FROM users WHERE id = $1',
                [bet.user_id]
            );

            const betUser = userInfo.rows[0];
            // 确定返还用户：员工下注返还给代理，代理下注返还给自己
            const returnUserId = (betUser.role === 'staff' && betUser.agent_id) ? betUser.agent_id : bet.user_id;

            const balanceResult = await query(
                'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
                [returnUserId]
            );
            const currentBalance = parseFloat(balanceResult.rows[0].balance);

            await query(`
                INSERT INTO coin_transactions (
                    user_id, account_id, bet_id, transaction_id, transaction_type,
                    description, amount, balance_before, balance_after
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                returnUserId,  // 返还给代理（如果是员工）或自己（如果是代理）
                bet.account_id,
                betId,
                transactionId,
                '返还',
                `下注派彩 - ${bet.bet_type} ${bet.bet_option}${betUser.role === 'staff' ? ` (员工: ${betUser.username})` : ''}`,
                payout,
                currentBalance,
                currentBalance + payout
            ]);
        }

        res.json({
            success: true,
            data: updateResult.rows[0],
            message: '下注状态更新成功'
        } as ApiResponse<Bet>);

    } catch (error) {
        console.error('更新下注状态错误:', error);
        res.status(500).json({
            success: false,
            error: '更新下注状态失败'
        });
    }
});

export { router as betRoutes };
