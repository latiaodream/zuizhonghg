export interface OddsApiEvent {
    id: number;
    home: string;
    away: string;
    date: string;
    sport_name: string;
    sport_slug: string;
    league_name: string;
    league_slug: string;
    status: string;
    home_score: number;
    away_score: number;
    odds?: OddsApiOdds[];
}

export interface OddsApiOdds {
    market_name: string;
    ml_home?: number;
    ml_draw?: number;
    ml_away?: number;
    spread_hdp?: number;
    spread_home?: number;
    spread_away?: number;
    totals_hdp?: number;
    totals_over?: number;
    totals_under?: number;
    updated_at: string;
}

export interface OddsApiLeague {
    league_name: string;
    league_slug: string;
    event_count: number;
}

export interface OddsApiStats {
    total_events: number;
    pending_events: number;
    live_events: number;
    settled_events: number;
    total_leagues: number;
    total_sports: number;
    total_odds: number;
    events_with_odds: number;
}

