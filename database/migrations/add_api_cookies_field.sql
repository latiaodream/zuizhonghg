-- 添加 API Cookies 字段到 crown_accounts 表
-- 用于持久化存储账号的登录 Cookie 信息

-- 添加 api_cookies 字段（存储登录后的 Cookie）
ALTER TABLE crown_accounts 
ADD COLUMN IF NOT EXISTS api_cookies TEXT;

-- 添加注释
COMMENT ON COLUMN crown_accounts.api_cookies IS '纯 API 登录后的 Cookie 字符串';

