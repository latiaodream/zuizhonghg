import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
    error: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.error('错误详情:', {
        message: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString()
    });

    // 数据库错误
    if (error.code === '23505') {
        return res.status(400).json({
            success: false,
            error: '数据已存在，请检查唯一性约束'
        });
    }

    // JWT错误
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            error: '无效的访问令牌'
        });
    }

    // 验证错误
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    // 默认服务器错误
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? '服务器内部错误'
            : error.message
    });
};