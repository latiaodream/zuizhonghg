import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../types';

interface AuthRequest extends Request {
    user?: User;
}

export const authenticateToken = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers['authorization'];
        let token = authHeader && authHeader.split(' ')[1];

        // 兼容 SSE/EventSource 无法自定义 Header 的情况：允许通过查询参数 token 传递
        if (!token) {
            const qToken = (req.query?.token as string) || '';
            if (qToken && typeof qToken === 'string') {
                token = qToken;
            }
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: '缺少访问令牌'
            });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET未配置');
        }

        const decoded = jwt.verify(token, secret) as any;
        req.user = decoded.user;
        next();
    } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(403).json({
            success: false,
            error: '无效的访问令牌'
        });
    }
};
