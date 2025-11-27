-- 皇冠注单本地存储表
-- 用于保存从皇冠 API 获取的实时注单记录

CREATE TABLE IF NOT EXISTS crown_wagers (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES crown_accounts(id),
    ticket_id VARCHAR(50) UNIQUE,
    league VARCHAR(200),
    team_h VARCHAR(200),
    team_c VARCHAR(200),
    score VARCHAR(50),
    bet_type VARCHAR(100),
    bet_team VARCHAR(200),
    spread VARCHAR(50),
    odds VARCHAR(20),
    gold DECIMAL(15,2),
    win_gold DECIMAL(15,2),
    status VARCHAR(50),
    result VARCHAR(50),
    wager_time TIMESTAMP,
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crown_wagers_account ON crown_wagers(account_id);
CREATE INDEX IF NOT EXISTS idx_crown_wagers_ticket ON crown_wagers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_crown_wagers_time ON crown_wagers(wager_time);

-- 皇冠账号添加 credit 字段（信用额度）
ALTER TABLE crown_accounts ADD COLUMN IF NOT EXISTS credit DECIMAL(15,2) DEFAULT 0;
