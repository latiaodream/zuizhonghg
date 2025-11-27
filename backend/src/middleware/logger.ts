import { Request, Response, NextFunction } from 'express';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const timestamp = new Date().toISOString();

        console.log(`${timestamp} ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);

        // 记录错误请求
        if (res.statusCode >= 400) {
            console.error(`错误请求: ${req.method} ${req.url} - ${res.statusCode}`);
        }
    });

    next();
};