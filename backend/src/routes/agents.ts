import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../models/database';
import { UserCreateRequest, ApiResponse, User } from '../types';
import { authenticateToken } from '../middleware/auth';
import { requireAdmin, AuthRequest } from '../middleware/permission';

const router = Router();

// 所有路由都需要认证
router.use(authenticateToken);

/**
 * 获取代理列表（仅超级管理员）
 */
router.get('/', requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        // 获取代理列表，并计算每个代理的皇冠额度（代理下所有皇冠账号的 credit 总和）
        const result = await query(
            `SELECT
                u.id,
                u.username,
                u.email,
                u.role,
                u.parent_id,
                u.agent_id,
                u.created_at,
                u.updated_at,
                COALESCE(SUM(ca.credit), 0) as credit_limit
            FROM users u
            LEFT JOIN crown_accounts ca ON ca.agent_id = u.id
            WHERE u.role = $1
            GROUP BY u.id, u.username, u.email, u.role, u.parent_id, u.agent_id, u.created_at, u.updated_at
            ORDER BY u.created_at DESC`,
            ['agent']
        );

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<User[]>);

    } catch (error) {
        console.error('获取代理列表错误:', error);
        res.status(500).json({
            success: false,
            error: '获取代理列表失败'
        });
    }
});

/**
 * 获取单个代理信息（仅超级管理员）
 */
router.get('/:userId', requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);

        const result = await query(
            'SELECT id, username, email, role, parent_id, agent_id, created_at, updated_at FROM users WHERE id = $1 AND role = $2',
            [userId, 'agent']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '代理不存在'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        } as ApiResponse<User>);

    } catch (error) {
        console.error('获取代理信息错误:', error);
        res.status(500).json({
            success: false,
            error: '获取代理信息失败'
        });
    }
});

/**
 * 创建代理账号（仅超级管理员）
 */
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const { username, email, password }: UserCreateRequest = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: '用户名和密码不能为空'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: '密码长度至少6位'
            });
        }

        // 检查用户名是否已存在（邮箱可以重复）
        const existingUser = await query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: '用户名已存在'
            });
        }

        // 加密密码
        const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // 创建代理账号（邮箱可选）
        const result = await query(
            'INSERT INTO users (username, email, password_hash, role, parent_id, agent_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role, parent_id, agent_id, created_at, updated_at',
            [username, email || null, passwordHash, 'agent', null, null]
        );

        const agent = result.rows[0];

        res.status(201).json({
            success: true,
            data: agent,
            message: '代理账号创建成功'
        } as ApiResponse<User>);

    } catch (error) {
        console.error('创建代理账号错误:', error);
        res.status(500).json({
            success: false,
            error: '创建代理账号失败'
        });
    }
});

/**
 * 更新代理信息（仅超级管理员）
 */
router.put('/:userId', requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);
        const { username, email, password } = req.body;

        // 验证代理是否存在
        const agentCheck = await query(
            'SELECT id FROM users WHERE id = $1 AND role = $2',
            [userId, 'agent']
        );

        if (agentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '代理不存在'
            });
        }

        // 构建更新字段
        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (username) {
            updates.push(`username = $${paramCount++}`);
            values.push(username);
        }

        if (email) {
            updates.push(`email = $${paramCount++}`);
            values.push(email);
        }

        if (password) {
            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    error: '密码长度至少6位'
                });
            }
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
            const passwordHash = await bcrypt.hash(password, saltRounds);
            updates.push(`password_hash = $${paramCount++}`);
            values.push(passwordHash);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: '没有需要更新的字段'
            });
        }

        updates.push(`updated_at = NOW()`);
        values.push(userId);

        const result = await query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, email, role, parent_id, agent_id, created_at, updated_at`,
            values
        );

        res.json({
            success: true,
            data: result.rows[0],
            message: '代理信息更新成功'
        } as ApiResponse<User>);

    } catch (error) {
        console.error('更新代理信息错误:', error);
        res.status(500).json({
            success: false,
            error: '更新代理信息失败'
        });
    }
});

/**
 * 删除代理账号（仅超级管理员）
 */
router.delete('/:userId', requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);

        // 检查代理是否存在
        const agentCheck = await query(
            'SELECT id FROM users WHERE id = $1 AND role = $2',
            [userId, 'agent']
        );

        if (agentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '代理不存在'
            });
        }

        // 检查代理是否有下属员工
        const staffCount = await query(
            'SELECT COUNT(*) as count FROM users WHERE parent_id = $1 OR agent_id = $1',
            [userId]
        );

        if (parseInt(staffCount.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: '该代理还有关联的员工，无法删除'
            });
        }

        // 删除代理
        await query(
            'DELETE FROM users WHERE id = $1',
            [userId]
        );

        res.json({
            success: true,
            message: '代理账号删除成功'
        } as ApiResponse);

    } catch (error) {
        console.error('删除代理账号错误:', error);
        res.status(500).json({
            success: false,
            error: '删除代理账号失败'
        });
    }
});

export { router as agentRoutes };
