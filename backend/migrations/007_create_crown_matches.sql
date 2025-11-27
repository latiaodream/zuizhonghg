-- 皇冠赛事数据表
-- 存储从皇冠 API 获取的赛事数据，用于匹配统计

CREATE TABLE IF NOT EXISTS crown_matches (
    id SERIAL PRIMARY KEY,
    
    -- 皇冠赛事信息
    crown_gid VARCHAR(50) NOT NULL UNIQUE,  -- 皇冠赛事 ID
    crown_league VARCHAR(200) NOT NULL,      -- 皇冠联赛名称（简体中文）
    crown_home VARCHAR(200) NOT NULL,        -- 皇冠主队名称（简体中文）
    crown_away VARCHAR(200) NOT NULL,        -- 皇冠客队名称（简体中文）
    match_time TIMESTAMP,                    -- 比赛时间
    
    -- 匹配状态
    league_matched BOOLEAN DEFAULT FALSE,    -- 联赛是否匹配
    home_matched BOOLEAN DEFAULT FALSE,      -- 主队是否匹配
    away_matched BOOLEAN DEFAULT FALSE,      -- 客队是否匹配
    
    -- 匹配的 iSports ID
    league_alias_id INTEGER REFERENCES league_aliases(id) ON DELETE SET NULL,
    home_alias_id INTEGER REFERENCES team_aliases(id) ON DELETE SET NULL,
    away_alias_id INTEGER REFERENCES team_aliases(id) ON DELETE SET NULL,
    
    -- 匹配方法（用于调试）
    league_match_method VARCHAR(50),  -- exact, canonical_key, fuzzy, similarity
    home_match_method VARCHAR(50),
    away_match_method VARCHAR(50),
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_crown_matches_gid ON crown_matches(crown_gid);
CREATE INDEX IF NOT EXISTS idx_crown_matches_league ON crown_matches(crown_league);
CREATE INDEX IF NOT EXISTS idx_crown_matches_match_time ON crown_matches(match_time);
CREATE INDEX IF NOT EXISTS idx_crown_matches_league_matched ON crown_matches(league_matched);
CREATE INDEX IF NOT EXISTS idx_crown_matches_home_matched ON crown_matches(home_matched);
CREATE INDEX IF NOT EXISTS idx_crown_matches_away_matched ON crown_matches(away_matched);
CREATE INDEX IF NOT EXISTS idx_crown_matches_league_alias_id ON crown_matches(league_alias_id);
CREATE INDEX IF NOT EXISTS idx_crown_matches_home_alias_id ON crown_matches(home_alias_id);
CREATE INDEX IF NOT EXISTS idx_crown_matches_away_alias_id ON crown_matches(away_alias_id);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_crown_matches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_crown_matches_updated_at
    BEFORE UPDATE ON crown_matches
    FOR EACH ROW
    EXECUTE FUNCTION update_crown_matches_updated_at();

-- 注释
COMMENT ON TABLE crown_matches IS '皇冠赛事数据表，用于存储和匹配皇冠赛事';
COMMENT ON COLUMN crown_matches.crown_gid IS '皇冠赛事唯一标识';
COMMENT ON COLUMN crown_matches.league_matched IS '联赛是否成功匹配到 iSports';
COMMENT ON COLUMN crown_matches.home_matched IS '主队是否成功匹配到 iSports';
COMMENT ON COLUMN crown_matches.away_matched IS '客队是否成功匹配到 iSports';
COMMENT ON COLUMN crown_matches.league_match_method IS '联赛匹配方法：exact, canonical_key, fuzzy, similarity';

