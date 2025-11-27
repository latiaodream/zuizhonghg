--
-- PostgreSQL database dump
--

-- Dumped from database version 14.18 (Homebrew)
-- Dumped by pg_dump version 14.18 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    id integer NOT NULL,
    filename text NOT NULL,
    applied_at timestamp without time zone DEFAULT now()
);


--
-- Name: _migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._migrations_id_seq OWNED BY public._migrations.id;


--
-- Name: account_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_history (
    id integer NOT NULL,
    account_id integer NOT NULL,
    date date NOT NULL,
    day_of_week character varying(10),
    bet_amount numeric(10,2) DEFAULT 0,
    valid_amount numeric(10,2) DEFAULT 0,
    win_loss numeric(10,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE account_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.account_history IS '账户历史数据表';


--
-- Name: COLUMN account_history.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_history.account_id IS '账号ID';


--
-- Name: COLUMN account_history.date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_history.date IS '日期';


--
-- Name: COLUMN account_history.day_of_week; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_history.day_of_week IS '星期几';


--
-- Name: COLUMN account_history.bet_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_history.bet_amount IS '投注金额';


--
-- Name: COLUMN account_history.valid_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_history.valid_amount IS '有效金额';


--
-- Name: COLUMN account_history.win_loss; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_history.win_loss IS '赢/输金额';


--
-- Name: account_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_history_id_seq OWNED BY public.account_history.id;


--
-- Name: account_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_shares (
    id integer NOT NULL,
    account_id integer NOT NULL,
    owner_user_id integer NOT NULL,
    shared_to_user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE account_shares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.account_shares IS '账号共享关系表';


--
-- Name: COLUMN account_shares.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_shares.account_id IS '被共享的账号ID';


--
-- Name: COLUMN account_shares.owner_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_shares.owner_user_id IS '账号所有者用户ID';


--
-- Name: COLUMN account_shares.shared_to_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_shares.shared_to_user_id IS '接收共享的用户ID';


--
-- Name: account_shares_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_shares_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_shares_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_shares_id_seq OWNED BY public.account_shares.id;


--
-- Name: bets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer NOT NULL,
    match_id integer NOT NULL,
    bet_type character varying(50) NOT NULL,
    bet_option character varying(100) NOT NULL,
    bet_amount numeric(15,2) NOT NULL,
    odds numeric(5,2) NOT NULL,
    single_limit numeric(15,2),
    interval_seconds integer DEFAULT 3,
    quantity integer DEFAULT 1,
    status character varying(20) DEFAULT 'pending'::character varying,
    result character varying(20),
    payout numeric(15,2) DEFAULT 0,
    profit_loss numeric(15,2) DEFAULT 0,
    official_bet_id character varying(100),
    confirmed_at timestamp without time zone,
    settled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    min_odds numeric(6,3),
    official_odds numeric(6,3),
    score character varying(50),
    virtual_bet_amount numeric(15,2),
    virtual_profit_loss numeric(15,2),
    market_category character varying(50),
    market_scope character varying(20),
    market_side character varying(20),
    market_line character varying(50),
    market_index integer,
    market_wtype character varying(20),
    market_rtype character varying(20),
    market_chose_team character varying(5)
);


--
-- Name: bets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bets_id_seq OWNED BY public.bets.id;


--
-- Name: coin_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coin_transactions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer,
    bet_id integer,
    transaction_id character varying(100) NOT NULL,
    transaction_type character varying(50) NOT NULL,
    description text,
    amount numeric(15,2) NOT NULL,
    balance_before numeric(15,2) NOT NULL,
    balance_after numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: coin_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coin_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coin_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coin_transactions_id_seq OWNED BY public.coin_transactions.id;


--
-- Name: crown_account_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crown_account_sessions (
    account_id integer NOT NULL,
    session_data jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: crown_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crown_accounts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    group_id integer NOT NULL,
    username character varying(100) NOT NULL,
    password character varying(255) NOT NULL,
    display_name character varying(100),
    platform character varying(50) DEFAULT '皇冠'::character varying,
    game_type character varying(50) DEFAULT '足球'::character varying,
    source character varying(50) DEFAULT '自有'::character varying,
    share_count integer DEFAULT 0,
    currency character varying(10) DEFAULT 'CNY'::character varying,
    discount numeric(3,2) DEFAULT 1.00,
    note character varying(50),
    balance numeric(15,2) DEFAULT 0,
    device_type character varying(50),
    user_agent text,
    proxy_enabled boolean DEFAULT false,
    proxy_type character varying(10),
    proxy_host character varying(255),
    proxy_port integer,
    proxy_username character varying(100),
    proxy_password character varying(255),
    football_prematch_limit numeric(15,2) DEFAULT 100000,
    football_live_limit numeric(15,2) DEFAULT 100000,
    basketball_prematch_limit numeric(15,2) DEFAULT 100000,
    basketball_live_limit numeric(15,2) DEFAULT 100000,
    is_enabled boolean DEFAULT true,
    is_online boolean DEFAULT false,
    last_login_at timestamp without time zone,
    status character varying(20) DEFAULT 'active'::character varying,
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    original_username character varying(100),
    initialized_username character varying(100),
    use_for_fetch boolean DEFAULT false,
    passcode character varying(20),
    stop_profit_limit numeric(15,2) DEFAULT 0,
    agent_id integer,
    api_uid character varying(255),
    api_login_time bigint,
    api_cookies text,
    init_type character varying(20) DEFAULT 'full'::character varying,
    limits_data jsonb,
    credit numeric(15,2) DEFAULT 0
);


--
-- Name: COLUMN crown_accounts.original_username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.original_username IS '原始账号（首次登录时的账号）';


--
-- Name: COLUMN crown_accounts.initialized_username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.initialized_username IS '修改后的账号（初始化后使用的账号）';


--
-- Name: COLUMN crown_accounts.agent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.agent_id IS '所属代理ID，冗余字段方便查询';


--
-- Name: COLUMN crown_accounts.api_uid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.api_uid IS '纯 API 登录后的 UID';


--
-- Name: COLUMN crown_accounts.api_login_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.api_login_time IS '纯 API 登录时间戳（毫秒）';


--
-- Name: COLUMN crown_accounts.api_cookies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.api_cookies IS '纯 API 登录后的 Cookie 字符串';


--
-- Name: COLUMN crown_accounts.init_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.init_type IS '初始化类型：none-不初始化, password_only-仅改密码, full-完整初始化';


--
-- Name: COLUMN crown_accounts.limits_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crown_accounts.limits_data IS '完整的限额数据（JSON 格式），包含所有投注类型的单场最高和单注最高';


--
-- Name: crown_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crown_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crown_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crown_accounts_id_seq OWNED BY public.crown_accounts.id;


--
-- Name: crown_wagers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crown_wagers (
    id integer NOT NULL,
    account_id integer NOT NULL,
    ticket_id character varying(50),
    league character varying(200),
    team_h character varying(200),
    team_c character varying(200),
    score character varying(50),
    bet_type character varying(100),
    bet_team character varying(200),
    spread character varying(50),
    odds character varying(20),
    gold numeric(15,2),
    win_gold numeric(15,2),
    status character varying(50),
    result character varying(50),
    wager_time timestamp without time zone,
    raw_data jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: crown_wagers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crown_wagers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crown_wagers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crown_wagers_id_seq OWNED BY public.crown_wagers.id;


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.groups_id_seq OWNED BY public.groups.id;


--
-- Name: league_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_aliases (
    id integer NOT NULL,
    canonical_key character varying(120) NOT NULL,
    name_en character varying(200),
    name_zh_cn character varying(200),
    name_zh_tw character varying(200),
    aliases jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: league_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.league_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: league_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.league_aliases_id_seq OWNED BY public.league_aliases.id;


--
-- Name: login_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_history (
    id integer NOT NULL,
    user_id integer NOT NULL,
    ip_address character varying(45) NOT NULL,
    user_agent text,
    login_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    success boolean DEFAULT true,
    verification_required boolean DEFAULT false
);


--
-- Name: login_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_history_id_seq OWNED BY public.login_history.id;


--
-- Name: match_odds_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_odds_history (
    id integer NOT NULL,
    match_id integer NOT NULL,
    markets jsonb NOT NULL,
    snapshot_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: match_odds_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_odds_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_odds_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_odds_history_id_seq OWNED BY public.match_odds_history.id;


--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    id integer NOT NULL,
    match_id character varying(100) NOT NULL,
    league_name character varying(200) NOT NULL,
    home_team character varying(100) NOT NULL,
    away_team character varying(100) NOT NULL,
    match_time timestamp without time zone NOT NULL,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    current_score character varying(20),
    match_period character varying(20),
    markets jsonb,
    source character varying(20) DEFAULT 'crown'::character varying,
    last_synced_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: matches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.matches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: matches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.matches_id_seq OWNED BY public.matches.id;


--
-- Name: oddsapi_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oddsapi_events (
    id bigint NOT NULL,
    home character varying(255) NOT NULL,
    away character varying(255) NOT NULL,
    date timestamp with time zone NOT NULL,
    sport_name character varying(100) NOT NULL,
    sport_slug character varying(100) NOT NULL,
    league_name character varying(255) NOT NULL,
    league_slug character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    home_score integer DEFAULT 0,
    away_score integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: oddsapi_odds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oddsapi_odds (
    id integer NOT NULL,
    event_id bigint NOT NULL,
    bookmaker character varying(100) NOT NULL,
    market_name character varying(50) NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    ml_home numeric(10,2),
    ml_draw numeric(10,2),
    ml_away numeric(10,2),
    spread_hdp numeric(10,2),
    spread_home numeric(10,2),
    spread_away numeric(10,2),
    totals_hdp numeric(10,2),
    totals_over numeric(10,2),
    totals_under numeric(10,2),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: oddsapi_odds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oddsapi_odds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oddsapi_odds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oddsapi_odds_id_seq OWNED BY public.oddsapi_odds.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    setting_key character varying(100) NOT NULL,
    setting_value text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: team_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_aliases (
    id integer NOT NULL,
    canonical_key character varying(120) NOT NULL,
    name_en character varying(200),
    name_zh_cn character varying(200),
    name_zh_tw character varying(200),
    aliases jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: team_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_aliases_id_seq OWNED BY public.team_aliases.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100),
    password_hash character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    role character varying(20) DEFAULT 'staff'::character varying,
    parent_id integer,
    agent_id integer,
    email_verified boolean DEFAULT false,
    email_verification_token character varying(255),
    email_verification_expires_at timestamp without time zone,
    trusted_ips text[],
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'agent'::character varying, 'staff'::character varying])::text[])))
);


--
-- Name: COLUMN users.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.email IS '用户邮箱，可选填写，首次登录时绑定。一个邮箱可以绑定多个账号。';


--
-- Name: COLUMN users.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.role IS '用户角色: admin=超级管理员, agent=代理, staff=员工';


--
-- Name: COLUMN users.parent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.parent_id IS '上级用户ID，员工指向代理';


--
-- Name: COLUMN users.agent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.agent_id IS '所属代理ID，快速查找';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_codes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    email character varying(100) NOT NULL,
    code character varying(6) NOT NULL,
    type character varying(20) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: verification_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.verification_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: verification_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.verification_codes_id_seq OWNED BY public.verification_codes.id;


--
-- Name: _migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations ALTER COLUMN id SET DEFAULT nextval('public._migrations_id_seq'::regclass);


--
-- Name: account_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_history ALTER COLUMN id SET DEFAULT nextval('public.account_history_id_seq'::regclass);


--
-- Name: account_shares id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_shares ALTER COLUMN id SET DEFAULT nextval('public.account_shares_id_seq'::regclass);


--
-- Name: bets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bets ALTER COLUMN id SET DEFAULT nextval('public.bets_id_seq'::regclass);


--
-- Name: coin_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions ALTER COLUMN id SET DEFAULT nextval('public.coin_transactions_id_seq'::regclass);


--
-- Name: crown_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_accounts ALTER COLUMN id SET DEFAULT nextval('public.crown_accounts_id_seq'::regclass);


--
-- Name: crown_wagers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_wagers ALTER COLUMN id SET DEFAULT nextval('public.crown_wagers_id_seq'::regclass);


--
-- Name: groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups ALTER COLUMN id SET DEFAULT nextval('public.groups_id_seq'::regclass);


--
-- Name: league_aliases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_aliases ALTER COLUMN id SET DEFAULT nextval('public.league_aliases_id_seq'::regclass);


--
-- Name: login_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history ALTER COLUMN id SET DEFAULT nextval('public.login_history_id_seq'::regclass);


--
-- Name: match_odds_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_odds_history ALTER COLUMN id SET DEFAULT nextval('public.match_odds_history_id_seq'::regclass);


--
-- Name: matches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches ALTER COLUMN id SET DEFAULT nextval('public.matches_id_seq'::regclass);


--
-- Name: oddsapi_odds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oddsapi_odds ALTER COLUMN id SET DEFAULT nextval('public.oddsapi_odds_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: team_aliases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_aliases ALTER COLUMN id SET DEFAULT nextval('public.team_aliases_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: verification_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes ALTER COLUMN id SET DEFAULT nextval('public.verification_codes_id_seq'::regclass);


--
-- Name: _migrations _migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_filename_key UNIQUE (filename);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: account_history account_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_history
    ADD CONSTRAINT account_history_pkey PRIMARY KEY (id);


--
-- Name: account_shares account_shares_account_id_shared_to_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_shares
    ADD CONSTRAINT account_shares_account_id_shared_to_user_id_key UNIQUE (account_id, shared_to_user_id);


--
-- Name: account_shares account_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_shares
    ADD CONSTRAINT account_shares_pkey PRIMARY KEY (id);


--
-- Name: bets bets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bets
    ADD CONSTRAINT bets_pkey PRIMARY KEY (id);


--
-- Name: coin_transactions coin_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions
    ADD CONSTRAINT coin_transactions_pkey PRIMARY KEY (id);


--
-- Name: coin_transactions coin_transactions_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions
    ADD CONSTRAINT coin_transactions_transaction_id_key UNIQUE (transaction_id);


--
-- Name: crown_account_sessions crown_account_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_account_sessions
    ADD CONSTRAINT crown_account_sessions_pkey PRIMARY KEY (account_id);


--
-- Name: crown_accounts crown_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_accounts
    ADD CONSTRAINT crown_accounts_pkey PRIMARY KEY (id);


--
-- Name: crown_wagers crown_wagers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_wagers
    ADD CONSTRAINT crown_wagers_pkey PRIMARY KEY (id);


--
-- Name: crown_wagers crown_wagers_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_wagers
    ADD CONSTRAINT crown_wagers_ticket_id_key UNIQUE (ticket_id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: league_aliases league_aliases_canonical_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_aliases
    ADD CONSTRAINT league_aliases_canonical_key_key UNIQUE (canonical_key);


--
-- Name: league_aliases league_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_aliases
    ADD CONSTRAINT league_aliases_pkey PRIMARY KEY (id);


--
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- Name: match_odds_history match_odds_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_odds_history
    ADD CONSTRAINT match_odds_history_pkey PRIMARY KEY (id);


--
-- Name: matches matches_match_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_match_id_key UNIQUE (match_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: oddsapi_events oddsapi_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oddsapi_events
    ADD CONSTRAINT oddsapi_events_pkey PRIMARY KEY (id);


--
-- Name: oddsapi_odds oddsapi_odds_event_id_bookmaker_market_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oddsapi_odds
    ADD CONSTRAINT oddsapi_odds_event_id_bookmaker_market_name_key UNIQUE (event_id, bookmaker, market_name);


--
-- Name: oddsapi_odds oddsapi_odds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oddsapi_odds
    ADD CONSTRAINT oddsapi_odds_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings settings_user_id_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_setting_key_key UNIQUE (user_id, setting_key);


--
-- Name: team_aliases team_aliases_canonical_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_aliases
    ADD CONSTRAINT team_aliases_canonical_key_key UNIQUE (canonical_key);


--
-- Name: team_aliases team_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_aliases
    ADD CONSTRAINT team_aliases_pkey PRIMARY KEY (id);


--
-- Name: account_history unique_account_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_history
    ADD CONSTRAINT unique_account_date UNIQUE (account_id, date);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: verification_codes verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_pkey PRIMARY KEY (id);


--
-- Name: idx_account_history_account_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_history_account_date ON public.account_history USING btree (account_id, date DESC);


--
-- Name: idx_account_history_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_history_date ON public.account_history USING btree (date DESC);


--
-- Name: idx_account_shares_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_shares_account_id ON public.account_shares USING btree (account_id);


--
-- Name: idx_account_shares_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_shares_owner_user_id ON public.account_shares USING btree (owner_user_id);


--
-- Name: idx_account_shares_shared_to_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_shares_shared_to_user_id ON public.account_shares USING btree (shared_to_user_id);


--
-- Name: idx_bets_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bets_account_id ON public.bets USING btree (account_id);


--
-- Name: idx_bets_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bets_created_at ON public.bets USING btree (created_at);


--
-- Name: idx_bets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bets_status ON public.bets USING btree (status);


--
-- Name: idx_bets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bets_user_id ON public.bets USING btree (user_id);


--
-- Name: idx_coin_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coin_transactions_created_at ON public.coin_transactions USING btree (created_at);


--
-- Name: idx_coin_transactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coin_transactions_user_id ON public.coin_transactions USING btree (user_id);


--
-- Name: idx_crown_accounts_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_agent_id ON public.crown_accounts USING btree (agent_id);


--
-- Name: idx_crown_accounts_api_login_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_api_login_time ON public.crown_accounts USING btree (api_login_time);


--
-- Name: idx_crown_accounts_api_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_api_uid ON public.crown_accounts USING btree (api_uid);


--
-- Name: idx_crown_accounts_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_group_id ON public.crown_accounts USING btree (group_id);


--
-- Name: idx_crown_accounts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_status ON public.crown_accounts USING btree (status);


--
-- Name: idx_crown_accounts_use_for_fetch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_use_for_fetch ON public.crown_accounts USING btree (use_for_fetch);


--
-- Name: idx_crown_accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_accounts_user_id ON public.crown_accounts USING btree (user_id);


--
-- Name: idx_crown_wagers_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_wagers_account ON public.crown_wagers USING btree (account_id);


--
-- Name: idx_crown_wagers_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_wagers_ticket ON public.crown_wagers USING btree (ticket_id);


--
-- Name: idx_crown_wagers_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crown_wagers_time ON public.crown_wagers USING btree (wager_time);


--
-- Name: idx_league_aliases_canonical_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_league_aliases_canonical_key ON public.league_aliases USING btree (canonical_key);


--
-- Name: idx_login_history_ip_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_ip_address ON public.login_history USING btree (ip_address);


--
-- Name: idx_login_history_login_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_login_time ON public.login_history USING btree (login_time);


--
-- Name: idx_login_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_user_id ON public.login_history USING btree (user_id);


--
-- Name: idx_match_odds_history_match_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_odds_history_match_id ON public.match_odds_history USING btree (match_id);


--
-- Name: idx_matches_match_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matches_match_time ON public.matches USING btree (match_time);


--
-- Name: idx_matches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matches_status ON public.matches USING btree (status);


--
-- Name: idx_oddsapi_events_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oddsapi_events_date ON public.oddsapi_events USING btree (date);


--
-- Name: idx_oddsapi_events_league; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oddsapi_events_league ON public.oddsapi_events USING btree (league_slug);


--
-- Name: idx_oddsapi_events_sport; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oddsapi_events_sport ON public.oddsapi_events USING btree (sport_slug);


--
-- Name: idx_oddsapi_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oddsapi_events_status ON public.oddsapi_events USING btree (status);


--
-- Name: idx_oddsapi_odds_bookmaker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oddsapi_odds_bookmaker ON public.oddsapi_odds USING btree (bookmaker);


--
-- Name: idx_oddsapi_odds_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oddsapi_odds_event_id ON public.oddsapi_odds USING btree (event_id);


--
-- Name: idx_team_aliases_canonical_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_aliases_canonical_key ON public.team_aliases USING btree (canonical_key);


--
-- Name: idx_users_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_agent_id ON public.users USING btree (agent_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_users_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_parent_id ON public.users USING btree (parent_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_verification_codes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_email ON public.verification_codes USING btree (email);


--
-- Name: idx_verification_codes_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_expires_at ON public.verification_codes USING btree (expires_at);


--
-- Name: idx_verification_codes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_user_id ON public.verification_codes USING btree (user_id);


--
-- Name: account_history account_history_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_history
    ADD CONSTRAINT account_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.crown_accounts(id) ON DELETE CASCADE;


--
-- Name: account_shares account_shares_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_shares
    ADD CONSTRAINT account_shares_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.crown_accounts(id) ON DELETE CASCADE;


--
-- Name: account_shares account_shares_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_shares
    ADD CONSTRAINT account_shares_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: account_shares account_shares_shared_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_shares
    ADD CONSTRAINT account_shares_shared_to_user_id_fkey FOREIGN KEY (shared_to_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bets bets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bets
    ADD CONSTRAINT bets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.crown_accounts(id);


--
-- Name: bets bets_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bets
    ADD CONSTRAINT bets_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id);


--
-- Name: bets bets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bets
    ADD CONSTRAINT bets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: coin_transactions coin_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions
    ADD CONSTRAINT coin_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.crown_accounts(id);


--
-- Name: coin_transactions coin_transactions_bet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions
    ADD CONSTRAINT coin_transactions_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES public.bets(id);


--
-- Name: coin_transactions coin_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_transactions
    ADD CONSTRAINT coin_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: crown_account_sessions crown_account_sessions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_account_sessions
    ADD CONSTRAINT crown_account_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.crown_accounts(id) ON DELETE CASCADE;


--
-- Name: crown_accounts crown_accounts_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_accounts
    ADD CONSTRAINT crown_accounts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crown_accounts crown_accounts_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_accounts
    ADD CONSTRAINT crown_accounts_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: crown_accounts crown_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_accounts
    ADD CONSTRAINT crown_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crown_wagers crown_wagers_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crown_wagers
    ADD CONSTRAINT crown_wagers_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.crown_accounts(id);


--
-- Name: groups groups_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: login_history login_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: match_odds_history match_odds_history_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_odds_history
    ADD CONSTRAINT match_odds_history_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;


--
-- Name: oddsapi_odds oddsapi_odds_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oddsapi_odds
    ADD CONSTRAINT oddsapi_odds_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.oddsapi_events(id) ON DELETE CASCADE;


--
-- Name: settings settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: verification_codes verification_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

