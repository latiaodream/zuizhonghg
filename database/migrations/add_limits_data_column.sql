-- 添加 limits_data 字段来存储完整的限额数据（JSON 格式）
ALTER TABLE crown_accounts ADD COLUMN IF NOT EXISTS limits_data JSONB;

-- 添加注释
COMMENT ON COLUMN crown_accounts.limits_data IS '完整的限额数据（JSON 格式），包含所有投注类型的单场最高和单注最高';

