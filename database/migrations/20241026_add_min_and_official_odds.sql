ALTER TABLE bets
    ADD COLUMN IF NOT EXISTS min_odds DECIMAL(6,3),
    ADD COLUMN IF NOT EXISTS official_odds DECIMAL(6,3);

UPDATE bets
SET official_odds = odds
WHERE official_odds IS NULL;
