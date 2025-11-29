import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { query } from '../models/database';
import {
	    CrownAccountCreateRequest,
	    ApiResponse,
	    CrownAccount,
	    AccountSelectionResponse,
} from '../types';
import { selectAccounts } from '../services/account-selection';
import {
	    parseLimitRange,
	    splitBetsForAccounts,
	    generateBetQueue,
} from '../utils/bet-splitter';

const router = Router();
router.use(authenticateToken);

const parseOptionalNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }

    const str = Array.isArray(value) ? value[0] : value;
    const num = Number(str);
    return Number.isFinite(num) ? num : undefined;
};

const getOptionalString = (value: unknown): string | undefined => {
	if (value === undefined || value === null) {
	    return undefined;
	}
	if (Array.isArray(value)) {
	    return String(value[0]);
	}
	return String(value);
};

// 账号优选（筛选可用账号）
router.get('/auto-select', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const matchId = parseOptionalNumber(req.query.match_id);
        const limit = parseOptionalNumber(req.query.limit);
	        const totalAmount = parseOptionalNumber(req.query.total_amount);
	        const quantity = parseOptionalNumber(req.query.quantity);
	        const singleLimitStr = getOptionalString(req.query.single_limit);

        if (req.query.match_id !== undefined && matchId === undefined) {
            return res.status(400).json({
                success: false,
                error: 'match_id 参数无效，应为数字'
            });
        }

        if (req.query.limit !== undefined && (limit === undefined || limit <= 0)) {
            return res.status(400).json({
                success: false,
                error: 'limit 参数无效，应为大于 0 的数字'
            });
        }

	        let selection = await selectAccounts({
            userId,
            userRole: req.user.role,
            agentId: req.user.agent_id,
            matchId,
            limit,
        });

	        // 如果传入了总金额，则基于当前优选结果和拆分规则，进一步按本次下注金额过滤「信用额度不够的账号」
	        if (totalAmount !== undefined && totalAmount > 0 && selection.eligible_accounts.length > 0) {
	            const allEligibleIds = selection.eligible_accounts.map((entry) => entry.account.id);
	            // 按照 quantity 限制实际参与拆分的账号数量（与 /bets 逻辑保持一致）
	            const quantityValue = quantity && quantity > 0 ? quantity : allEligibleIds.length;
	            const actualAccountIds = allEligibleIds.slice(0, Math.min(quantityValue, allEligibleIds.length));

	            if (actualAccountIds.length > 0) {
	                // 读取账号的折扣、限额、信用额度（与 /bets 中保持一致）
	                const accountsResult = await query(
	                    'SELECT id, discount, football_prematch_limit, football_live_limit, credit FROM crown_accounts WHERE id = ANY($1)',
	                    [actualAccountIds],
	                );

	                const accountDiscounts = new Map<number, number>();
	                const accountLimits = new Map<number, { min: number; max: number }>();
	                const accountCredits = new Map<number, number>();

	                for (const row of accountsResult.rows) {
	                    const accountId = Number(row.id);
	                    const discount = Number(row.discount) || 1.0;
	                    accountDiscounts.set(accountId, discount);

	                    const limitValue = Number(row.football_prematch_limit) || Number(row.football_live_limit) || 0;
	                    if (limitValue > 0) {
	                        accountLimits.set(accountId, { min: 50, max: limitValue });
	                    }

	                    if (row.credit !== undefined && row.credit !== null) {
	                        const credit = Number(row.credit);
	                        if (!Number.isNaN(credit)) {
	                            accountCredits.set(accountId, credit);
	                        }
	                    }
	                }

	                const singleLimitRange = parseLimitRange(singleLimitStr);

	                try {
	                    const betSplits = splitBetsForAccounts({
	                        totalRealAmount: totalAmount,
	                        accountIds: actualAccountIds,
	                        accountDiscounts,
	                        singleLimitRange: singleLimitRange || undefined,
	                        accountLimits: singleLimitRange ? undefined : accountLimits,
	                    });

	                    const betQueue = generateBetQueue(betSplits);

	                    // 按账号统计本次需要的总虚数金额
	                    const accountVirtualTotals = new Map<number, number>();
	                    for (const split of betQueue) {
	                        const prev = accountVirtualTotals.get(split.accountId) || 0;
	                        accountVirtualTotals.set(split.accountId, prev + split.virtualAmount);
	                    }

	                    const insufficientCreditAccounts = new Set<number>();
	                    for (const [accountId, totalVirtual] of accountVirtualTotals.entries()) {
	                        const credit = accountCredits.get(accountId);
	                        // 只有当配置了正数信用额度时才做检查（与 /bets 保持一致）
	                        if (credit !== undefined && credit > 0 && totalVirtual > credit) {
	                            insufficientCreditAccounts.add(accountId);
	                        }
	                    }

	                    if (insufficientCreditAccounts.size > 0) {
	                        console.warn('⚠️ 账号优选：以下账号本次信用额度不足，将从可下注列表中移除:', Array.from(insufficientCreditAccounts));
	                    }

	                    // 仅保留本次拆分中且信用额度足够的账号作为 eligible_accounts
	                    const allowedIdSet = new Set<number>();
	                    for (const id of actualAccountIds) {
	                        if (!insufficientCreditAccounts.has(id)) {
	                            allowedIdSet.add(id);
	                        }
	                    }

	                    const filteredEligible = selection.eligible_accounts.filter((entry) => allowedIdSet.has(entry.account.id));
	                    const movedToExcluded = selection.eligible_accounts.filter((entry) => !allowedIdSet.has(entry.account.id));

	                    selection = {
	                        ...selection,
	                        eligible_accounts: filteredEligible,
	                        excluded_accounts: [...selection.excluded_accounts, ...movedToExcluded],
	                    };
	                } catch (error: any) {
	                    console.error('账号优选拆分金额失败:', error);
	                    return res.status(400).json({
	                        success: false,
	                        error: `金额拆分失败: ${error.message || error}`,
	                    });
	                }
	            }
	        }

	        res.json({
	            success: true,
	            data: selection,
	        } as ApiResponse<AccountSelectionResponse>);

    } catch (error) {
        console.error('账号优选失败:', error);
        res.status(500).json({
            success: false,
            error: '账号优选失败'
        });
    }
});

// 获取账号列表
router.get('/', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const agentId = req.user.agent_id;
        const { group_id } = req.query;

        let sql: string;
        let params: any[];

        if (userRole === 'admin') {
            // 管理员可以查看所有账号
            sql = `
                SELECT ca.*, g.name as group_name, u.username as owner_username
                FROM crown_accounts ca
                JOIN groups g ON ca.group_id = g.id
                JOIN users u ON ca.user_id = u.id
                WHERE 1=1
            `;
            params = [];
        } else if (userRole === 'agent') {
            // 代理可以查看下属员工的所有账号
            sql = `
                SELECT ca.*, g.name as group_name, u.username as owner_username
                FROM crown_accounts ca
                JOIN groups g ON ca.group_id = g.id
                JOIN users u ON ca.user_id = u.id
                WHERE ca.agent_id = $1
            `;
            params = [userId];
        } else {
            // 员工可以查看同一代理下的所有账号（共享账号池）
            sql = `
                SELECT ca.*, g.name as group_name, u.username as owner_username
                FROM crown_accounts ca
                JOIN groups g ON ca.group_id = g.id
                JOIN users u ON ca.user_id = u.id
                WHERE ca.agent_id = $1
            `;
            params = [agentId];
        }

        if (group_id) {
            sql += ` AND ca.group_id = $${params.length + 1}`;
            params.push(group_id);
        }

        sql += ' ORDER BY ca.created_at DESC';

        const result = await query(sql, params);

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<CrownAccount[]>);

    } catch (error) {
        console.error('获取账号列表错误:', error);
        res.status(500).json({
            success: false,
            error: '获取账号列表失败'
        });
    }
});

// 创建新账号
router.post('/', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const agentId = req.user.agent_id;
        const accountData: CrownAccountCreateRequest = req.body;

        // 只有员工可以创建皇冠账号
        if (userRole !== 'staff') {
            return res.status(403).json({
                success: false,
                error: '只有员工可以创建皇冠账号'
            });
        }

        if (!accountData.username || !accountData.password || !accountData.group_id) {
            return res.status(400).json({
                success: false,
                error: '用户名、密码和分组不能为空'
            });
        }

        // 验证分组是否属于当前用户
        const groupCheck = await query(
            'SELECT id FROM groups WHERE id = $1 AND user_id = $2',
            [accountData.group_id, userId]
        );

        if (groupCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: '分组不存在或无权限'
            });
        }

        const discountRaw = accountData.discount ?? 1.0;
        const discount = Number(discountRaw);
        if (!Number.isFinite(discount) || discount <= 0 || discount > 1) {
            return res.status(400).json({
                success: false,
                error: '折扣需大于 0 且小于等于 1',
            });
        }

        let normalizedProxyType = accountData.proxy_type?.toUpperCase() || null;
        let proxyHost = accountData.proxy_host?.trim() || null;
        const proxyPort = accountData.proxy_port ?? null;

        if (accountData.proxy_enabled) {
            if (!normalizedProxyType || !['HTTP', 'HTTPS', 'SOCKS5'].includes(normalizedProxyType)) {
                return res.status(400).json({
                    success: false,
                    error: '代理类型无效，仅支持 HTTP/HTTPS/SOCKS5',
                });
            }

            if (!proxyHost) {
                return res.status(400).json({
                    success: false,
                    error: '启用代理时必须填写代理地址',
                });
            }

            if (!proxyPort || proxyPort <= 0 || proxyPort > 65535) {
                return res.status(400).json({
                    success: false,
                    error: '启用代理时必须填写合法的代理端口',
                });
            }
        } else {
            normalizedProxyType = null;
            proxyHost = null;
        }

        const stopProfitRaw = accountData.stop_profit_limit ?? 0;
        const stopProfitLimit = Number(stopProfitRaw);
        if (!Number.isFinite(stopProfitLimit) || stopProfitLimit < 0) {
            return res.status(400).json({
                success: false,
                error: '止盈金额必须是大于等于 0 的数字',
            });
        }

        const proxyUsername = accountData.proxy_enabled ? accountData.proxy_username || null : null;
        const proxyPassword = accountData.proxy_enabled ? accountData.proxy_password || null : null;

        // 获取初始化类型，默认为 'full'
        const initType = accountData.init_type || 'full';

        // 🔥 新逻辑：不再验证 original_username 和 initialized_username
        // 因为现在登录时会自动初始化，不需要用户手动填写这些字段
        // initType 只是用来标记账号的初始化方式，实际初始化在登录时自动完成

        const result = await query(`
            INSERT INTO crown_accounts (
                user_id, group_id, agent_id, username, password, passcode, display_name,
                original_username, initialized_username, init_type,
                game_type, source, currency, discount, note, device_type, stop_profit_limit,
                proxy_enabled, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password,
                football_prematch_limit, football_live_limit, basketball_prematch_limit, basketball_live_limit
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
            RETURNING *
        `, [
            userId,
            accountData.group_id,
            agentId, // 设置 agent_id
            accountData.username,
            accountData.password,
            accountData.passcode || null,
            accountData.display_name || `${accountData.username} (${accountData.username.slice(0, 6)})`,
            accountData.original_username || null,
            accountData.initialized_username || null,
            initType,
            accountData.game_type || '足球',
            accountData.source || '自有',
            accountData.currency || 'CNY',
            discount,
            accountData.note || '高',
            accountData.device_type || 'iPhone 14',
            stopProfitLimit,
            accountData.proxy_enabled || false,
            normalizedProxyType,
            proxyHost,
            proxyPort,
            proxyUsername,
            proxyPassword,
            accountData.football_prematch_limit || 100000,
            accountData.football_live_limit || 100000,
            accountData.basketball_prematch_limit || 100000,
            accountData.basketball_live_limit || 100000
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: '账号创建成功'
        } as ApiResponse<CrownAccount>);

    } catch (error) {
        console.error('创建账号错误:', error);
        res.status(500).json({
            success: false,
            error: '创建账号失败'
        });
    }
});

// 更新账号
router.put('/:id', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const agentId = req.user.agent_id;
        const accountId = parseInt(req.params.id);
        const updateData = req.body;

        // 检查账号权限
        let accountCheck;
        if (userRole === 'admin') {
            // 管理员可以编辑所有账号
            accountCheck = await query(
                'SELECT id FROM crown_accounts WHERE id = $1',
                [accountId]
            );
        } else if (userRole === 'agent') {
            // 代理可以编辑自己代理下的所有账号
            accountCheck = await query(
                'SELECT id FROM crown_accounts WHERE id = $1 AND agent_id = $2',
                [accountId, userId]
            );
        } else {
            // 员工可以编辑同一代理下的所有账号（共享账号池）
            accountCheck = await query(
                'SELECT id FROM crown_accounts WHERE id = $1 AND agent_id = $2',
                [accountId, agentId]
            );
        }

        if (accountCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '账号不存在或无权限'
            });
        }

        if (updateData.discount !== undefined && updateData.discount !== null) {
            const numericDiscount = Number(updateData.discount);
            if (!Number.isFinite(numericDiscount) || numericDiscount <= 0 || numericDiscount > 1) {
                return res.status(400).json({
                    success: false,
                    error: '折扣需大于 0 且小于等于 1',
                });
            }
            updateData.discount = numericDiscount;
        }

        if (updateData.stop_profit_limit !== undefined && updateData.stop_profit_limit !== null) {
            const stopProfitValue = Number(updateData.stop_profit_limit);
            if (!Number.isFinite(stopProfitValue) || stopProfitValue < 0) {
                return res.status(400).json({
                    success: false,
                    error: '止盈金额必须是大于等于 0 的数字',
                });
            }
            updateData.stop_profit_limit = stopProfitValue;
        }

        if (updateData.proxy_enabled === true) {
            const proxyType = updateData.proxy_type?.toUpperCase();
            if (!proxyType || !['HTTP', 'HTTPS', 'SOCKS5'].includes(proxyType)) {
                return res.status(400).json({
                    success: false,
                    error: '代理类型无效，仅支持 HTTP/HTTPS/SOCKS5',
                });
            }
            if (!updateData.proxy_host?.trim()) {
                return res.status(400).json({
                    success: false,
                    error: '启用代理时必须填写代理地址',
                });
            }
            if (!updateData.proxy_port || updateData.proxy_port <= 0 || updateData.proxy_port > 65535) {
                return res.status(400).json({
                    success: false,
                    error: '启用代理时必须填写合法的代理端口',
                });
            }
            updateData.proxy_type = proxyType;
            updateData.proxy_host = updateData.proxy_host.trim();
        } else if (updateData.proxy_enabled === false) {
            updateData.proxy_type = null;
            updateData.proxy_host = null;
            updateData.proxy_port = null;
            updateData.proxy_username = null;
            updateData.proxy_password = null;
        }

        const result = await query(`
            UPDATE crown_accounts SET
                username = COALESCE($1, username),
                password = COALESCE($2, password),
                passcode = COALESCE($3, passcode),
                display_name = COALESCE($4, display_name),
                game_type = COALESCE($5, game_type),
                source = COALESCE($6, source),
                currency = COALESCE($7, currency),
                discount = COALESCE($8, discount),
                note = COALESCE($9, note),
                stop_profit_limit = COALESCE($10, stop_profit_limit),
                device_type = COALESCE($11, device_type),
                proxy_enabled = COALESCE($12, proxy_enabled),
                proxy_type = COALESCE($13, proxy_type),
                proxy_host = COALESCE($14, proxy_host),
                proxy_port = COALESCE($15, proxy_port),
                proxy_username = COALESCE($16, proxy_username),
                proxy_password = COALESCE($17, proxy_password),
                is_enabled = COALESCE($18, is_enabled),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $19 AND user_id = $20
            RETURNING *
        `, [
            updateData.username,
            updateData.password,
            updateData.passcode,
            updateData.display_name,
            updateData.game_type,
            updateData.source,
            updateData.currency,
            updateData.discount,
            updateData.note,
            updateData.stop_profit_limit,
            updateData.device_type,
            updateData.proxy_enabled,
            updateData.proxy_type,
            updateData.proxy_host,
            updateData.proxy_port,
            updateData.proxy_username,
            updateData.proxy_password,
            updateData.is_enabled,
            accountId,
            userId
        ]);

        res.json({
            success: true,
            data: result.rows[0],
            message: '账号更新成功'
        } as ApiResponse<CrownAccount>);

    } catch (error) {
        console.error('更新账号错误:', error);
        res.status(500).json({
            success: false,
            error: '更新账号失败'
        });
    }
});

// 删除账号
router.delete('/:id', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const accountId = parseInt(req.params.id);

        // 检查账号是否属于当前用户
        const accountCheck = await query(
            'SELECT id FROM crown_accounts WHERE id = $1 AND user_id = $2',
            [accountId, userId]
        );

        if (accountCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '账号不存在'
            });
        }

        // 先删除关联的下注记录（或者将 account_id 设为 NULL）
        await query(
            'UPDATE bets SET account_id = NULL WHERE account_id = $1',
            [accountId]
        );

        // 再删除账号
        await query(
            'DELETE FROM crown_accounts WHERE id = $1 AND user_id = $2',
            [accountId, userId]
        );

        res.json({
            success: true,
            message: '账号删除成功'
        } as ApiResponse);

    } catch (error) {
        console.error('删除账号错误:', error);
        res.status(500).json({
            success: false,
            error: '删除账号失败'
        });
    }
});

// 批量更新账号状态
router.post('/batch-update-status', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const { account_ids, is_enabled } = req.body;

        if (!Array.isArray(account_ids) || account_ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: '请选择要更新的账号'
            });
        }

        const placeholders = account_ids.map((_, index) => `$${index + 3}`).join(',');
        
        await query(
            `UPDATE crown_accounts SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE user_id = $2 AND id IN (${placeholders})`,
            [is_enabled, userId, ...account_ids]
        );

        res.json({
            success: true,
            message: `批量更新${account_ids.length}个账号状态成功`
        } as ApiResponse);

    } catch (error) {
        console.error('批量更新账号状态错误:', error);
        res.status(500).json({
            success: false,
            error: '批量更新账号状态失败'
        });
    }
});

export { router as accountRoutes };
