import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'bclogin_system',
    user: process.env.DB_USER || 'lt',
    password: process.env.DB_PASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// 数据库连接测试
pool.on('connect', () => {
    console.log('✅ 数据库连接成功');
});

pool.on('error', (err) => {
    console.error('❌ 数据库连接错误:', err);
    process.exit(-1);
});

export { pool };

// 通用查询函数
export const query = (text: string, params?: any[]) => {
    console.log('执行SQL:', text, params);
    return pool.query(text, params);
};