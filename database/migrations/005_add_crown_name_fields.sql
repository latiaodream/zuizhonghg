-- 增加皇冠信用盘简体中文字段

ALTER TABLE league_aliases ADD COLUMN IF NOT EXISTS name_crown_zh_cn VARCHAR(200);
ALTER TABLE team_aliases ADD COLUMN IF NOT EXISTS name_crown_zh_cn VARCHAR(200);

-- 创建索引以便搜索
CREATE INDEX IF NOT EXISTS idx_league_aliases_crown_zh_cn ON league_aliases(name_crown_zh_cn);
CREATE INDEX IF NOT EXISTS idx_team_aliases_crown_zh_cn ON team_aliases(name_crown_zh_cn);

