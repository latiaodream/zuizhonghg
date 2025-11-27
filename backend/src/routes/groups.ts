import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { query } from '../models/database';
import { GroupCreateRequest, ApiResponse, Group } from '../types';

const router = Router();

// 所有分组路由都需要认证
router.use(authenticateToken);

// 获取用户的所有分组
router.get('/', async (req: any, res) => {
    try {
        const userId = req.user.id;

        const result = await query(
            'SELECT * FROM groups WHERE user_id = $1 ORDER BY created_at ASC',
            [userId]
        );

        res.json({
            success: true,
            data: result.rows
        } as ApiResponse<Group[]>);

    } catch (error) {
        console.error('获取分组列表错误:', error);
        res.status(500).json({
            success: false,
            error: '获取分组列表失败'
        });
    }
});

// 创建新分组
router.post('/', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const { name, description }: GroupCreateRequest = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: '分组名称不能为空'
            });
        }

        // 检查分组名称是否重复
        const existing = await query(
            'SELECT id FROM groups WHERE user_id = $1 AND name = $2',
            [userId, name]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: '分组名称已存在'
            });
        }

        const result = await query(
            'INSERT INTO groups (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
            [userId, name, description || '']
        );

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: '分组创建成功'
        } as ApiResponse<Group>);

    } catch (error) {
        console.error('创建分组错误:', error);
        res.status(500).json({
            success: false,
            error: '创建分组失败'
        });
    }
});

// 更新分组
router.put('/:id', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const groupId = parseInt(req.params.id);
        const { name, description }: GroupCreateRequest = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: '分组名称不能为空'
            });
        }

        // 检查分组是否属于当前用户
        const groupCheck = await query(
            'SELECT id FROM groups WHERE id = $1 AND user_id = $2',
            [groupId, userId]
        );

        if (groupCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '分组不存在'
            });
        }

        // 检查名称是否与其他分组重复
        const nameCheck = await query(
            'SELECT id FROM groups WHERE user_id = $1 AND name = $2 AND id != $3',
            [userId, name, groupId]
        );

        if (nameCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: '分组名称已存在'
            });
        }

        const result = await query(
            'UPDATE groups SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 RETURNING *',
            [name, description || '', groupId, userId]
        );

        res.json({
            success: true,
            data: result.rows[0],
            message: '分组更新成功'
        } as ApiResponse<Group>);

    } catch (error) {
        console.error('更新分组错误:', error);
        res.status(500).json({
            success: false,
            error: '更新分组失败'
        });
    }
});

// 删除分组
router.delete('/:id', async (req: any, res) => {
    try {
        const userId = req.user.id;
        const groupId = parseInt(req.params.id);

        // 检查分组是否属于当前用户
        const groupCheck = await query(
            'SELECT id FROM groups WHERE id = $1 AND user_id = $2',
            [groupId, userId]
        );

        if (groupCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '分组不存在'
            });
        }

        // 检查分组下是否有账号
        const accountCheck = await query(
            'SELECT COUNT(*) as count FROM crown_accounts WHERE group_id = $1',
            [groupId]
        );

        if (parseInt(accountCheck.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: '该分组下还有账号，无法删除'
            });
        }

        await query(
            'DELETE FROM groups WHERE id = $1 AND user_id = $2',
            [groupId, userId]
        );

        res.json({
            success: true,
            message: '分组删除成功'
        } as ApiResponse);

    } catch (error) {
        console.error('删除分组错误:', error);
        res.status(500).json({
            success: false,
            error: '删除分组失败'
        });
    }
});

export { router as groupRoutes };