ALTER TABLE bets
    ADD COLUMN virtual_bet_amount DECIMAL(15,2),
    ADD COLUMN virtual_profit_loss DECIMAL(15,2),
    ADD COLUMN result_score VARCHAR(50),
    ADD COLUMN result_text VARCHAR(255);
