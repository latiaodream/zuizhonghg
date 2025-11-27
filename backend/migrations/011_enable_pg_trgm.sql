-- 为 crown_matches 表创建索引以加速模糊查询
-- 用于通过球队名称模糊匹配查找皇冠比赛

-- 为时间范围查询创建索引
CREATE INDEX IF NOT EXISTS idx_crown_matches_match_time ON crown_matches (match_time);

-- 为球队名称和联赛名称创建索引（用于 ILIKE 查询）
CREATE INDEX IF NOT EXISTS idx_crown_matches_home_lower ON crown_matches (LOWER(crown_home));
CREATE INDEX IF NOT EXISTS idx_crown_matches_away_lower ON crown_matches (LOWER(crown_away));
CREATE INDEX IF NOT EXISTS idx_crown_matches_league_lower ON crown_matches (LOWER(crown_league));

