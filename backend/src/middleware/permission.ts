import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { query } from '../models/database';

// 扩展 Express Request 类型以包含用户信息
export interface AuthRequest extends Request {
    user?: {
        id: number;
        username: string;
        email: string;
        role: UserRole;
        parent_id?: number;
        agent_id?: number;
    };
}

/**
 * 角色验证中间件
 * 验证用户是否具有指定的角色之一
 */
export function requireRole(...allowedRoles: UserRole[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: '未授权访问'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: '权限不足'
            });
        }

        next();
    };
}

/**
 * 代理权限验证中间件
 * 验证用户是否为代理或管理员
 */
export const requireAgent = requireRole('admin', 'agent');

/**
 * 员工权限验证中间件
 * 验证用户是否为员工、代理或管理员
 */
export const requireStaff = requireRole('admin', 'agent', 'staff');

/**
 * 管理员权限验证中间件
 * 验证用户是否为管理员
 */
export const requireAdmin = requireRole('admin');

/**
 * 层级验证中间件
 * 验证目标用户是否是当前用户的下级
 */
export async function requireHierarchy(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: '未授权访问'
        });
    }

    const targetUserId = parseInt(req.params.userId || req.body.user_id);

    if (isNaN(targetUserId)) {
        return res.status(400).json({
            success: false,
            error: '无效的用户ID'
        });
    }

    // 管理员可以访问所有用户
    if (req.user.role === 'admin') {
        return next();
    }

    // 代理只能访问自己创建的员工
    if (req.user.role === 'agent') {
        const result = await query(
            'SELECT parent_id FROM users WHERE id = $1',
            [targetUserId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '用户不存在'
            });
        }

        if (result.rows[0].parent_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: '无权访问此用户'
            });
        }

        return next();
    }

    // 员工不能访问其他用户
    return res.status(403).json({
        success: false,
        error: '权限不足'
    });
}

/**
 * 资源所有权验证中间件工厂函数
 * 验证资源是否属于当前用户或其下级
 */
export function requireResourceOwnership(resourceType: 'crown_account' | 'group') {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: '未授权访问'
            });
        }

        const resourceId = parseInt(req.params.id);

        if (isNaN(resourceId)) {
            return res.status(400).json({
                success: false,
                error: '无效的资源ID'
            });
        }

        // 管理员可以访问所有资源
        if (req.user.role === 'admin') {
            return next();
        }

        if (resourceType === 'crown_account') {
            // 验证皇冠账号所有权
            if (req.user.role === 'staff') {
                // 员工只能访问自己创建的账号
                const result = await query(
                    'SELECT user_id FROM crown_accounts WHERE id = $1',
                    [resourceId]
                );

                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: '资源不存在'
                    });
                }

                if (result.rows[0].user_id !== req.user.id) {
                    return res.status(403).json({
                        success: false,
                        error: '无权访问此资源'
                    });
                }
            } else if (req.user.role === 'agent') {
                // 代理可以访问其下属员工创建的所有账号
                const result = await query(
                    `SELECT ca.user_id
                     FROM crown_accounts ca
                     JOIN users u ON ca.user_id = u.id
                     WHERE ca.id = $1 AND u.agent_id = $2`,
                    [resourceId, req.user.id]
                );

                if (result.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        error: '无权访问此资源'
                    });
                }
            }
        } else if (resourceType === 'group') {
            // 验证分组所有权
            if (req.user.role === 'staff') {
                const result = await query(
                    'SELECT user_id FROM groups WHERE id = $1',
                    [resourceId]
                );

                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: '资源不存在'
                    });
                }

                if (result.rows[0].user_id !== req.user.id) {
                    return res.status(403).json({
                        success: false,
                        error: '无权访问此资源'
                    });
                }
            } else if (req.user.role === 'agent') {
                const result = await query(
                    `SELECT g.user_id
                     FROM groups g
                     JOIN users u ON g.user_id = u.id
                     WHERE g.id = $1 AND u.agent_id = $2`,
                    [resourceId, req.user.id]
                );

                if (result.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        error: '无权访问此资源'
                    });
                }
            }
        }

        next();
    };
}
