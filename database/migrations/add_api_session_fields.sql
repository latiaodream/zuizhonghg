-- 添加 API 会话字段到 crown_accounts 表
-- 用于持久化存储账号的登录会话信息

-- 添加 api_uid 字段（存储登录后的 UID）
ALTER TABLE crown_accounts 
ADD COLUMN IF NOT EXISTS api_uid VARCHAR(255);

-- 添加 api_login_time 字段（存储登录时间戳）
ALTER TABLE crown_accounts 
ADD COLUMN IF NOT EXISTS api_login_time BIGINT;

-- 添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_crown_accounts_api_uid ON crown_accounts(api_uid);
CREATE INDEX IF NOT EXISTS idx_crown_accounts_api_login_time ON crown_accounts(api_login_time);

-- 添加注释
COMMENT ON COLUMN crown_accounts.api_uid IS '纯 API 登录后的 UID';
COMMENT ON COLUMN crown_accounts.api_login_time IS '纯 API 登录时间戳（毫秒）';

