import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../models/database';
import { UserCreateRequest, ApiResponse, User } from '../types';
import { authenticateToken } from '../middleware/auth';
import { requireAgent, requireHierarchy, AuthRequest } from '../middleware/permission';

const router = Router();

// 所有路由都需要认证
router.use(authenticateToken);

/**
 * 获取员工列表
 * 代理可以查看自己创建的所有员工
 * 管理员可以查看所有员工
 */
router.get('/', requireAgent, async (req: AuthRequest, res: Response) => {
    try {
        let staffQuery: string;
        let staffParams: any[];

        if (req.user!.role === 'admin') {
            // 管理员可以查看所有员工，并计算每个员工所属代理的皇冠额度总和
            staffQuery = `SELECT
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
            LEFT JOIN crown_accounts ca ON ca.agent_id = u.agent_id
            WHERE u.role = $1
            GROUP BY u.id, u.username, u.email, u.role, u.parent_id, u.agent_id, u.created_at, u.updated_at
            ORDER BY u.created_at DESC`;
            staffParams = ['staff'];
        } else {
            // 代理只能查看自己创建的员工，并计算代理下所有皇冠账号的额度总和
            staffQuery = `SELECT
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
            LEFT JOIN crown_accounts ca ON ca.agent_id = u.agent_id
            WHERE u.role = $1 AND u.parent_id = $2
            GROUP BY u.id, u.username, u.email, u.role, u.parent_id, u.agent_id, u.created_at, u.updated_at
            ORDER BY u.created_at DESC`;
            staffParams = ['staff', req.user!.id];
        }

        const result = await query(staffQuery, staffParams);

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<User[]>);

    } catch (error) {
        console.error('获取员工列表错误:', error);
        res.status(500).json({
            success: false,
            error: '获取员工列表失败'
        });
    }
});

/**
 * 获取单个员工信息
 * 需要验证层级关系
 */
router.get('/:userId', requireAgent, requireHierarchy, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);

        const result = await query(
            'SELECT id, username, email, role, parent_id, agent_id, created_at, updated_at FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '员工不存在'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        } as ApiResponse<User>);

    } catch (error) {
        console.error('获取员工信息错误:', error);
        res.status(500).json({
            success: false,
            error: '获取员工信息失败'
        });
    }
});

/**
 * 创建员工账号
 * 只有代理可以创建员工
 */
router.post('/', requireAgent, async (req: AuthRequest, res: Response) => {
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

        // 创建员工账号（邮箱可选）
        const result = await query(
            'INSERT INTO users (username, email, password_hash, role, parent_id, agent_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role, parent_id, agent_id, created_at, updated_at',
            [username, email || null, passwordHash, 'staff', req.user!.id, req.user!.id]
        );

        const staff = result.rows[0];

        // 为员工创建默认分组
        await query(
            'INSERT INTO groups (user_id, name, description) VALUES ($1, $2, $3)',
            [staff.id, '默认分组', '系统自动创建的默认分组']
        );

        res.status(201).json({
            success: true,
            data: staff,
            message: '员工账号创建成功'
        } as ApiResponse<User>);

    } catch (error) {
        console.error('创建员工账号错误:', error);
        res.status(500).json({
            success: false,
            error: '创建员工账号失败'
        });
    }
});

/**
 * 更新员工信息
 * 需要验证层级关系
 */
router.put('/:userId', requireAgent, requireHierarchy, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);
        const { username, email, password } = req.body;

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

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '员工不存在'
            });
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: '员工信息更新成功'
        } as ApiResponse<User>);

    } catch (error) {
        console.error('更新员工信息错误:', error);
        res.status(500).json({
            success: false,
            error: '更新员工信息失败'
        });
    }
});

/**
 * 删除员工账号
 * 需要验证层级关系
 */
router.delete('/:userId', requireAgent, requireHierarchy, async (req: AuthRequest, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);

        // 检查员工是否有关联的皇冠账号
        const crownAccountsResult = await query(
            'SELECT COUNT(*) as count FROM crown_accounts WHERE user_id = $1',
            [userId]
        );

        if (parseInt(crownAccountsResult.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: '该员工还有关联的皇冠账号，无法删除'
            });
        }

        // 删除员工
        const result = await query(
            'DELETE FROM users WHERE id = $1 RETURNING id',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '员工不存在'
            });
        }

        res.json({
            success: true,
            message: '员工账号删除成功'
        } as ApiResponse);

    } catch (error) {
        console.error('删除员工账号错误:', error);
        res.status(500).json({
            success: false,
            error: '删除员工账号失败'
        });
    }
});

export { router as staffRoutes };
