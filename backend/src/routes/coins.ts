import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { query } from '../models/database';
import { ApiResponse, CoinTransaction } from '../types';

const router = Router();
router.use(authenticateToken);

// 获取金币流水记录
router.get('/', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const { type, start_date, end_date, limit = 50, offset = 0 } = req.query;

        let sql = `
            SELECT ct.*, ca.username as account_username, ca.display_name as account_display_name
            FROM coin_transactions ct
            LEFT JOIN crown_accounts ca ON ct.account_id = ca.id
            WHERE ct.user_id = $1
        `;
        const params = [userId];
        let paramIndex = 2;

        if (type) {
            sql += ` AND ct.transaction_type = $${paramIndex++}`;
            params.push(type);
        }

        if (start_date) {
            sql += ` AND DATE(ct.created_at) >= $${paramIndex++}`;
            params.push(start_date);
        }

        if (end_date) {
            sql += ` AND DATE(ct.created_at) <= $${paramIndex++}`;
            params.push(end_date);
        }

        sql += ` ORDER BY ct.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await query(sql, params);

        // 获取当前余额
        const balanceResult = await query(
            'SELECT COALESCE(SUM(amount), 0) as current_balance FROM coin_transactions WHERE user_id = $1',
            [userId]
        );

        // 获取统计数据
        const statsResult = await query(`
            SELECT 
                transaction_type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total_amount
            FROM coin_transactions 
            WHERE user_id = $1
            GROUP BY transaction_type
        `, [userId]);

        const stats = {
            current_balance: parseFloat(balanceResult.rows[0].current_balance),
            transaction_summary: statsResult.rows.reduce((acc: any, row: any) => {
                acc[row.transaction_type] = {
                    count: parseInt(row.count),
                    total_amount: parseFloat(row.total_amount)
                };
                return acc;
            }, {})
        };

        res.json({
            success: true,
            data: {
                transactions: result.rows,
                stats
            }
        } as ApiResponse);

    } catch (error) {
        console.error('获取金币流水错误:', error);
        res.status(500).json({
            success: false,
            error: '获取金币流水失败'
        });
    }
});

// 创建金币交易记录(手动调整)
router.post('/', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const { transaction_type, amount, description, account_id } = req.body;

        if (!transaction_type || !amount || !description) {
            return res.status(400).json({
                success: false,
                error: '交易类型、金额和描述不能为空'
            });
        }

        // 获取当前余额
        const balanceResult = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [userId]
        );
        const currentBalance = parseFloat(balanceResult.rows[0].balance);

        // 生成交易ID
        const transactionId = `MANUAL${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

        const result = await query(`
            INSERT INTO coin_transactions (
                user_id, account_id, transaction_id, transaction_type,
                description, amount, balance_before, balance_after
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            userId,
            account_id || null,
            transactionId,
            transaction_type,
            description,
            parseFloat(amount),
            currentBalance,
            currentBalance + parseFloat(amount)
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: '金币交易记录创建成功'
        } as ApiResponse<CoinTransaction>);

    } catch (error) {
        console.error('创建金币交易错误:', error);
        res.status(500).json({
            success: false,
            error: '创建金币交易失败'
        });
    }
});

// 获取用户余额
router.get('/balance', async (req: any, res) => {
    try {
        const userId = req.user.id;

        const result = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [userId]
        );

        res.json({
            success: true,
            data: {
                balance: parseFloat(result.rows[0].balance),
                currency: 'CNY'
            }
        } as ApiResponse);

    } catch (error) {
        console.error('获取用户余额错误:', error);
        res.status(500).json({
            success: false,
            error: '获取用户余额失败'
        });
    }
});

// 获取指定用户的余额（管理员和代理可以查看下属的余额）
router.get('/balance/:userId', async (req: any, res) => {
    try {
        const currentUserId = req.user.id;
        const currentUserRole = req.user.role;
        const targetUserId = parseInt(req.params.userId);

        // 权限验证
        if (currentUserRole === 'admin') {
            // 管理员可以查看任何人的余额
        } else if (currentUserRole === 'agent') {
            // 代理可以查看自己和自己员工的余额
            if (targetUserId !== currentUserId) {
                const targetUserResult = await query(
                    'SELECT agent_id FROM users WHERE id = $1',
                    [targetUserId]
                );
                if (targetUserResult.rows.length === 0 || targetUserResult.rows[0].agent_id !== currentUserId) {
                    return res.status(403).json({
                        success: false,
                        error: '您没有权限查看该用户的余额'
                    });
                }
            }
        } else {
            // 员工只能查看自己的余额
            if (targetUserId !== currentUserId) {
                return res.status(403).json({
                    success: false,
                    error: '您没有权限查看该用户的余额'
                });
            }
        }

        const result = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [targetUserId]
        );

        res.json({
            success: true,
            data: {
                balance: parseFloat(result.rows[0].balance),
                currency: 'CNY'
            }
        } as ApiResponse);

    } catch (error) {
        console.error('获取用户余额错误:', error);
        res.status(500).json({
            success: false,
            error: '获取用户余额失败'
        });
    }
});

// 获取金币统计分析
router.get('/analytics', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const { period = '7d' } = req.query;

        let dateFilter = '';
        switch (period) {
            case '1d':
                dateFilter = "AND created_at >= CURRENT_DATE";
                break;
            case '7d':
                dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'";
                break;
            case '30d':
                dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'";
                break;
            case '90d':
                dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '90 days'";
                break;
        }

        // 日度统计
        const dailyResult = await query(`
            SELECT
                DATE(created_at) as date,
                transaction_type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total_amount
            FROM coin_transactions
            WHERE user_id = $1 ${dateFilter}
            GROUP BY DATE(created_at), transaction_type
            ORDER BY date DESC
        `, [userId]);

        // 总体统计
        const totalResult = await query(`
            SELECT
                COUNT(*) as total_transactions,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as total_expense,
                COALESCE(SUM(amount), 0) as net_amount
            FROM coin_transactions
            WHERE user_id = $1 ${dateFilter}
        `, [userId]);

        res.json({
            success: true,
            data: {
                period,
                daily_stats: dailyResult.rows,
                summary: totalResult.rows[0]
            }
        } as ApiResponse);

    } catch (error) {
        console.error('获取金币统计错误:', error);
        res.status(500).json({
            success: false,
            error: '获取金币统计失败'
        });
    }
});

// 充值（管理员给代理充值，代理给员工充值）
router.post('/recharge', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { target_user_id, amount, description } = req.body;

        // 验证参数
        if (!target_user_id || !amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: '目标用户和金额不能为空，且金额必须大于0'
            });
        }

        // 查询目标用户信息
        const targetUserResult = await query(
            'SELECT id, username, role, agent_id FROM users WHERE id = $1',
            [target_user_id]
        );

        if (targetUserResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '目标用户不存在'
            });
        }

        const targetUser = targetUserResult.rows[0];

        // 权限验证
        if (userRole === 'admin') {
            // 管理员可以给任何人充值（无限额）
        } else if (userRole === 'agent') {
            // 代理只能给自己的员工充值
            if (targetUser.agent_id !== userId) {
                return res.status(403).json({
                    success: false,
                    error: '您只能给自己的员工充值'
                });
            }

            // 检查代理余额是否足够
            const agentBalanceResult = await query(
                'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
                [userId]
            );
            const agentBalance = parseFloat(agentBalanceResult.rows[0].balance);

            if (agentBalance < amount) {
                return res.status(400).json({
                    success: false,
                    error: `余额不足，当前余额：${agentBalance}，需要：${amount}`
                });
            }
        } else {
            // 员工不能充值
            return res.status(403).json({
                success: false,
                error: '您没有权限进行充值操作'
            });
        }

        // 获取目标用户当前余额
        const targetBalanceResult = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [target_user_id]
        );
        const targetCurrentBalance = parseFloat(targetBalanceResult.rows[0].balance);

        // 生成交易ID
        const transactionId = `RECHARGE${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

        // 如果是代理充值，先扣除代理的金币
        if (userRole === 'agent') {
            const agentBalanceResult = await query(
                'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
                [userId]
            );
            const agentCurrentBalance = parseFloat(agentBalanceResult.rows[0].balance);

            await query(`
                INSERT INTO coin_transactions (
                    user_id, transaction_id, transaction_type,
                    description, amount, balance_before, balance_after
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                userId,
                `${transactionId}_OUT`,
                '转出',
                description || `充值给 ${targetUser.username}`,
                -amount,
                agentCurrentBalance,
                agentCurrentBalance - amount
            ]);
        }

        // 给目标用户充值
        const result = await query(`
            INSERT INTO coin_transactions (
                user_id, transaction_id, transaction_type,
                description, amount, balance_before, balance_after
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            target_user_id,
            transactionId,
            '充值',
            description || `充值 ${amount} 金币`,
            amount,
            targetCurrentBalance,
            targetCurrentBalance + amount
        ]);

        res.status(201).json({
            success: true,
            data: {
                ...result.rows[0],
                new_balance: targetCurrentBalance + amount
            },
            message: '充值成功'
        } as ApiResponse<CoinTransaction>);

    } catch (error) {
        console.error('充值错误:', error);
        res.status(500).json({
            success: false,
            error: '充值失败'
        });
    }
});

// 转账（代理之间转账，或管理员转账）
router.post('/transfer', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { target_user_id, amount, description } = req.body;

        // 验证参数
        if (!target_user_id || !amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: '目标用户和金额不能为空，且金额必须大于0'
            });
        }

        if (target_user_id === userId) {
            return res.status(400).json({
                success: false,
                error: '不能给自己转账'
            });
        }

        // 查询目标用户信息
        const targetUserResult = await query(
            'SELECT id, username, role FROM users WHERE id = $1',
            [target_user_id]
        );

        if (targetUserResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '目标用户不存在'
            });
        }

        const targetUser = targetUserResult.rows[0];

        // 检查发送方余额
        const senderBalanceResult = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [userId]
        );
        const senderBalance = parseFloat(senderBalanceResult.rows[0].balance);

        if (senderBalance < amount) {
            return res.status(400).json({
                success: false,
                error: `余额不足，当前余额：${senderBalance}，需要：${amount}`
            });
        }

        // 获取接收方当前余额
        const receiverBalanceResult = await query(
            'SELECT COALESCE(SUM(amount), 0) as balance FROM coin_transactions WHERE user_id = $1',
            [target_user_id]
        );
        const receiverBalance = parseFloat(receiverBalanceResult.rows[0].balance);

        // 生成交易ID
        const transactionId = `TRANSFER${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

        // 扣除发送方金币
        await query(`
            INSERT INTO coin_transactions (
                user_id, transaction_id, transaction_type,
                description, amount, balance_before, balance_after
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            userId,
            `${transactionId}_OUT`,
            '转出',
            description || `转账给 ${targetUser.username}`,
            -amount,
            senderBalance,
            senderBalance - amount
        ]);

        // 增加接收方金币
        const result = await query(`
            INSERT INTO coin_transactions (
                user_id, transaction_id, transaction_type,
                description, amount, balance_before, balance_after
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            target_user_id,
            `${transactionId}_IN`,
            '转入',
            description || `收到转账`,
            amount,
            receiverBalance,
            receiverBalance + amount
        ]);

        res.status(201).json({
            success: true,
            data: {
                ...result.rows[0],
                sender_new_balance: senderBalance - amount,
                receiver_new_balance: receiverBalance + amount
            },
            message: '转账成功'
        } as ApiResponse<CoinTransaction>);

    } catch (error) {
        console.error('转账错误:', error);
        res.status(500).json({
            success: false,
            error: '转账失败'
        });
    }
});

export { router as coinRoutes };