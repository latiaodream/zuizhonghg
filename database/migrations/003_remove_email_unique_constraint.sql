-- 移除邮箱唯一性约束，允许一个邮箱绑定多个账号
-- 这样可以让多个账号使用同一个邮箱接收验证码

-- 删除邮箱唯一性约束
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

-- 允许邮箱为 NULL（创建账号时可以不填邮箱）
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 创建索引以提高查询性能（非唯一索引）
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- 注释说明
COMMENT ON COLUMN users.email IS '用户邮箱，可选填写，首次登录时绑定。一个邮箱可以绑定多个账号。';

