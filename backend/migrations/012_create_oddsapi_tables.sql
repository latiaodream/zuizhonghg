-- 创建 Odds-API.io 赛事表
CREATE TABLE IF NOT EXISTS oddsapi_events (
    id BIGINT PRIMARY KEY,
    home VARCHAR(255) NOT NULL,
    away VARCHAR(255) NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    sport_name VARCHAR(100) NOT NULL,
    sport_slug VARCHAR(100) NOT NULL,
    league_name VARCHAR(255) NOT NULL,
    league_slug VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    home_score INTEGER DEFAULT 0,
    away_score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建 Odds-API.io 赔率表
CREATE TABLE IF NOT EXISTS oddsapi_odds (
    id SERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES oddsapi_events(id) ON DELETE CASCADE,
    bookmaker VARCHAR(100) NOT NULL,
    market_name VARCHAR(50) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    
    -- ML (独赢) 赔率
    ml_home DECIMAL(10, 2),
    ml_draw DECIMAL(10, 2),
    ml_away DECIMAL(10, 2),
    
    -- Spread (让球) 赔率
    spread_hdp DECIMAL(10, 2),
    spread_home DECIMAL(10, 2),
    spread_away DECIMAL(10, 2),
    
    -- Totals (大小球) 赔率
    totals_hdp DECIMAL(10, 2),
    totals_over DECIMAL(10, 2),
    totals_under DECIMAL(10, 2),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(event_id, bookmaker, market_name)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_oddsapi_events_date ON oddsapi_events(date);
CREATE INDEX IF NOT EXISTS idx_oddsapi_events_status ON oddsapi_events(status);
CREATE INDEX IF NOT EXISTS idx_oddsapi_events_league ON oddsapi_events(league_slug);
CREATE INDEX IF NOT EXISTS idx_oddsapi_events_sport ON oddsapi_events(sport_slug);
CREATE INDEX IF NOT EXISTS idx_oddsapi_odds_event_id ON oddsapi_odds(event_id);
CREATE INDEX IF NOT EXISTS idx_oddsapi_odds_bookmaker ON oddsapi_odds(bookmaker);

