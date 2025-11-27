-- Create league_aliases and team_aliases tables (idempotent)

CREATE TABLE IF NOT EXISTS league_aliases (
    id SERIAL PRIMARY KEY,
    canonical_key VARCHAR(120) NOT NULL UNIQUE,
    name_en VARCHAR(200),
    name_zh_cn VARCHAR(200),
    name_zh_tw VARCHAR(200),
    aliases JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_aliases (
    id SERIAL PRIMARY KEY,
    canonical_key VARCHAR(120) NOT NULL UNIQUE,
    name_en VARCHAR(200),
    name_zh_cn VARCHAR(200),
    name_zh_tw VARCHAR(200),
    aliases JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_aliases_canonical_key ON league_aliases(canonical_key);
CREATE INDEX IF NOT EXISTS idx_team_aliases_canonical_key ON team_aliases(canonical_key);

