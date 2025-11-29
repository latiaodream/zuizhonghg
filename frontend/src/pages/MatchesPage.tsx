import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Select, Button, Input, message, Empty, Typography, Spin } from 'antd';
import { accountApi, crownApi } from '../services/api';
import { ReloadOutlined } from '@ant-design/icons';
import BetFormModal, { type SelectionMeta, type MarketScope } from '../components/Betting/BetFormModal';
import type { CrownAccount, Match as MatchType } from '../types';
import dayjs from 'dayjs';

const { Title } = Typography;

// Helper functions (omitted for brevity but kept in actual implementation)
const manualName = (value: string | null | undefined, fallback: string): string => {
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
};

const buildLiveClock = (period?: string | null, clock?: string | null): string => {
  const p = (period ?? '').trim();
  const c = (clock ?? '').trim();
  if (c.includes('^')) return c;
  if (p.includes('^')) {
    if (!c) return p;
    const normalizedClock = c.startsWith('^') ? c.slice(1) : c;
    return `${p}${normalizedClock.startsWith('^') ? '' : '^'}${normalizedClock}`;
  }
  if (p && c) {
    const normalizedClock = c.startsWith('^') ? c.slice(1) : c;
    return `${p}^${normalizedClock}`;
  }
  return c || p || '';
};

const parseHandicapDecimal = (line?: string): number | null => {
  if (!line) return null;
  const cleaned = String(line).replace(/[^\d./+\-\s]/g, '').replace(/\s+/g, '');
  if (!cleaned) return null;
  let working = cleaned;
  let globalSign = 1;
  if (working.startsWith('-')) { globalSign = -1; working = working.slice(1); }
  else if (working.startsWith('+')) working = working.slice(1);
  const parts = working.split('/');
  const values: number[] = [];
  for (const partRaw of parts) {
    if (!partRaw) continue;
    let part = partRaw;
    let localSign = globalSign;
    if (part.startsWith('-')) { localSign = -1; part = part.slice(1); }
    else if (part.startsWith('+')) { localSign = 1; part = part.slice(1); }
    const num = parseFloat(part);
    if (Number.isFinite(num)) values.push(num * localSign);
  }
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  return Number.isFinite(avg) ? avg : null;
};

const formatHandicapValue = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return '';
  if (Math.abs(value) < 1e-4) return '0';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const absValue = Math.abs(value);
  const str = Number.isInteger(absValue) ? absValue.toString() : absValue.toFixed(2).replace(/\.?0+$/, '');
  return `${sign}${str}`;
};

const convertMatch = (matchData: any, showType: 'live' | 'today' | 'early'): MatchType => {
  const nowIso = new Date().toISOString();
  const status: MatchType['status'] = showType === 'live' ? 'live' : 'scheduled';
  return {
    id: Number(matchData.gid) || 0,
    match_id: String(matchData.gid || nowIso),
    league_name: matchData.league || '',
    home_team: matchData.home || '',
    away_team: matchData.away || '',
    match_time: matchData.time || nowIso,
    status,
    current_score: matchData.score || '',
    match_period: [matchData.period, matchData.clock].filter(Boolean).join(' '),
    markets: matchData.markets || {},
    crown_gid: matchData.crown_gid || matchData.crownGid || null,
    last_synced_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  };
};

const MatchesPage: React.FC = () => {
  const [showtype, setShowtype] = useState<'live' | 'today' | 'early'>('live');
  const [gtype, setGtype] = useState<'ft' | 'bk'>('ft');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [betModalVisible, setBetModalVisible] = useState(false);
  const [betModalKey, setBetModalKey] = useState(0);
  const [selectedMatch, setSelectedMatch] = useState<MatchType | null>(null);
  const [selectionPreset, setSelectionPreset] = useState<SelectionMeta | null>(null);
  const [accounts, setAccounts] = useState<CrownAccount[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const wsRef = useRef<WebSocket | null>(null);

  const buildCacheKey = (gt: string, st: string) => `matches_cache_v1:${gt}:${st}`;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchAccounts = async (silent = false) => {
    try {
      const res = await accountApi.getAccounts();
      if (res.success && res.data) setAccounts(res.data);
      else if (!silent) message.error(res.error || '获取账号列表失败');
    } catch (error) {
      if (!silent) message.error('获取账号列表失败');
    }
  };

  useEffect(() => { fetchAccounts(true); }, []);

  // WebSocket 实时订阅（使用 VITE_WS_URL / VITE_WS_AUTH_TOKEN）
  const handleWsMessage = useCallback((raw: any) => {
    if (!raw || typeof raw !== 'object') return;
    const { type, data } = raw as { type?: string; data?: any };
    if (!type || !data) return;

    // 忽略第三方数据，后面需要的话可以单独做页面
    if (type === 'thirdparty_full_data' || type === 'thirdparty_update') return;

    // 全量数据：直接覆盖当前列表
    if (type === 'full_data') {
      const showType = String(data.showType || '').toLowerCase();
      if (showType && showType !== showtype) return;
      const list = Array.isArray(data.matches) ? data.matches : [];
      setMatches(list);
      setLastUpdatedAt(Date.now());
      return;
    }

    // 新增 / 更新 / 赔率 / 比分：按 gid 合并到现有列表
    if (type === 'match_add' || type === 'match_update' || type === 'odds_update' || type === 'score_update') {
      const showType = String(data.showType || '').toLowerCase();
      if (showType && showType !== showtype) return;
      const match = data.match;
      if (!match) return;
      const gid = match.gid ?? data.gid ?? match.match_id;
      if (!gid) return;

      setMatches((prev) => {
        const idx = prev.findIndex((m: any) => (m.gid ?? m.match_id) === gid);
        if (idx === -1) {
          return [...prev, match];
        }
        const prevMatch = prev[idx];
        const merged: any = { ...prevMatch, ...match };
        if (match.markets || prevMatch.markets) {
          merged.markets = { ...(prevMatch.markets || {}), ...(match.markets || {}) };
        }
        const next = [...prev];
        next[idx] = merged;
        return next;
      });
      setLastUpdatedAt(Date.now());
      return;
    }

    // 删除赛事
    if (type === 'match_remove') {
      const showType = String(data.showType || '').toLowerCase();
      if (showType && showType !== showtype) return;
      const gid = data.gid;
      if (!gid) return;
      setMatches((prev) => prev.filter((m: any) => (m.gid ?? m.match_id) !== gid));
      setLastUpdatedAt(Date.now());
      return;
    }

    // 心跳 / 错误仅做日志
    if (type === 'heartbeat') {
      // 可根据 data.status 查看各 showType 的场次数
      return;
    }
    if (type === 'error') {
      // eslint-disable-next-line no-console
      console.error('[WS] error message', data);
      return;
    }
  }, [showtype]);

  useEffect(() => {
    const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;
    const WS_TOKEN = import.meta.env.VITE_WS_AUTH_TOKEN as string | undefined;

    if (!WS_URL || !WS_TOKEN || typeof WebSocket === 'undefined') {
      return;
    }

    let isUnmounted = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (isUnmounted) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          try {
            ws.send(JSON.stringify({ type: 'auth', data: { token: WS_TOKEN } }));
            ws.send(JSON.stringify({
              type: 'subscribe',
              data: {
                showTypes: [showtype],
                includeThirdparty: false,
              },
            }));
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[WS] send auth/subscribe failed', err);
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[WS] parse message failed', err);
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (!isUnmounted) {
            reconnectTimer = window.setTimeout(connect, 5000);
          }
        };

        ws.onerror = (event) => {
          // eslint-disable-next-line no-console
          console.error('[WS] error', event);
          // 交给 onclose 去处理重连
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[WS] connect failed', err);
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [showtype, handleWsMessage]);

  const loadMatches = async () => {
    setLoading(true);
    try {
      const res = await crownApi.getMatchesSystem({
        gtype,
        showtype,
        rtype: showtype === 'live' ? 'rb' : 'r',
        ltype: '3',
        sorttype: 'L',
      });
			if (res.success && res.data) {
				const next = res.data.matches || [];
				// 避免接口偶发读到空集把现有列表“清零”，保留上一份非空数据做兜底
				setMatches((prev) => {
					if (next.length === 0 && prev.length > 0) {
						return prev;
					}
					return next;
				});
				setLastUpdatedAt(Date.now());
			}
    } catch (error) {
      message.error('加载赛事失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 优先尝试读取本地缓存，避免刷新页面时列表瞬间变成 0 场
    try {
      const key = buildCacheKey(gtype, showtype);
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.matches)) {
          setMatches(parsed.matches);
        }
        if (parsed.lastUpdatedAt) {
          setLastUpdatedAt(parsed.lastUpdatedAt);
        }
      }
    } catch {
      // 读缓存失败忽略
    }

    // WSS 作为主数据源，API 只在首次加载时调用一次作为初始数据
    loadMatches();
    // 不再轮询 API，完全依赖 WSS 推送
    // const interval = setInterval(loadMatches, 10000);
    // return () => clearInterval(interval);
  }, [showtype, gtype]);

  // 每次获得新的非空赛事列表时，写入 localStorage，做简单持久化
  useEffect(() => {
    try {
      if (matches && matches.length > 0) {
        const key = buildCacheKey(gtype, showtype);
        const payload = { matches, lastUpdatedAt };
        window.localStorage.setItem(key, JSON.stringify(payload));
      }
    } catch {
      // 本地存储失败忽略
    }
  }, [matches, gtype, showtype, lastUpdatedAt]);

  const filtered = useMemo(() => {
    if (!search.trim()) return matches;
    const k = search.trim().toLowerCase();
    return matches.filter((m: any) => {
      const leagueLabel = m.league || m.league_name;
      const homeLabel = m.home || m.home_team;
      const awayLabel = m.away || m.away_team;
      return [leagueLabel, homeLabel, awayLabel].some((v: any) => String(v || '').toLowerCase().includes(k));
    });
  }, [matches, search]);

	  // 提供给下注弹窗的比赛快照获取函数：
	  // 根据 crown_gid / gid / match_id / id 在当前 WSS 实时列表中查找最新数据，
	  // 确保“实时赔率”能够跟随 WSS 推送更新，而不是停留在打开弹窗时的旧数据。
	  const getMatchSnapshot = useCallback(
	    (matchId: string | number | null | undefined) => {
	      if (!matchId) return null;
	      const target = String(matchId);
	      return (
	        matches.find((m: any) => {
	          const key = m.crown_gid || m.gid || m.match_id || m.id;
	          return String(key) === target;
	        }) || null
	      );
	    },
	    [matches],
	  );

  const openBetModal = (matchData: any, selection: SelectionMeta) => {
    // 自动添加 lid（联赛ID）
    const lid = matchData.lid || matchData.league_id || matchData.raw?.game?.LID || matchData._rawGame?.LID;
    console.log('🔍 openBetModal matchData.lid:', matchData.lid, 'matchData.league_id:', matchData.league_id, '提取的lid:', lid);
    console.log('🔍 openBetModal selection:', selection);
    console.log('🔍 openBetModal selection.spread_gid:', selection.spread_gid, 'selection.market_line:', selection.market_line);
    const selectionWithLid = { ...selection, lid };
	    setSelectedMatch(convertMatch(matchData, showtype));
    setSelectionPreset(selectionWithLid);
    setBetModalKey((prev) => prev + 1);
    setBetModalVisible(true);
  };

  const closeBetModal = () => {
    setBetModalVisible(false);
    setSelectedMatch(null);
    setSelectionPreset(null);
  };

  const renderLastUpdated = () => {
    if (!lastUpdatedAt) return '从未';
    return dayjs(lastUpdatedAt).format('HH:mm:ss');
  };

  const MarketCell = ({ label, odds, onClick }: { label?: string, odds?: string, onClick?: () => void }) => {
    if (!odds) return <div className="market-cell empty"><span className="odds-value-display empty closed">停</span></div>;
    return (
      <div className="market-cell" onClick={onClick}>
        {label && <div className="handicap-label">{label}</div>}
        <div className="odds-value-display">{odds}</div>
      </div>
    );
  };

  return (
    <div className="matches-page" style={{ padding: isMobile ? 0 : '4px 8px' }}>
      <Card className="matches-filter-card glass-panel" bodyStyle={{ padding: isMobile ? 12 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Select
              value={gtype}
              onChange={(v) => setGtype(v as any)}
              style={{ width: 110 }}
              size="large"
              options={[{ label: '足球', value: 'ft' }, { label: '篮球', value: 'bk' }]}
            />
            <Select
              value={showtype}
              onChange={(v) => setShowtype(v as any)}
              style={{ width: 110 }}
              size="large"
              options={[{ label: '滚球', value: 'live' }, { label: '今日', value: 'today' }, { label: '早盘', value: 'early' }]}
            />
            <div className="matches-meta">当前赛事：{filtered.length} 场</div>
          </div>
          <Input
            allowClear
            placeholder="搜索联赛/球队"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: isMobile ? '100%' : 240, marginTop: isMobile ? 8 : 0 }}
          />
        </div>
      </Card>

      <Card className="matches-card glass-panel">
        <Spin spinning={loading} tip="加载中..." delay={200}>
          {filtered.length === 0 ? (
            <Empty description="暂无赛事" />
          ) : (
            <div className="matches-table-container">
              {filtered.map((m: any, idx: number) => {
                const leagueLabel = manualName(m.league ?? m.league_name, '未识别联赛');
                const homeLabel = manualName(m.home ?? m.home_team, '-');
                const awayLabel = manualName(m.away ?? m.away_team, '-');
                // 优先使用 retimeset（如 "2H^93:26"），否则用 period/clock
                const retimeset = m.retimeset || m.RETIMESET || '';
                const period = retimeset || m.period || m.match_period || '';
                const clock = retimeset || m.clock || '';
                const scoreLabel = m.score || m.current_score || '';
	                const markets = m.markets || {};

	                // 从 moreMarkets.game[] 提取盘口线并带上 gid
	                const extractLinesFromMoreMarkets = (moreMarkets: any) => {
	                  const handicapLines: any[] = [];
	                  const overUnderLines: any[] = [];
	                  const halfHandicapLines: any[] = [];
	                  const halfOverUnderLines: any[] = [];
	                  if (!moreMarkets?.game) return { handicapLines, overUnderLines, halfHandicapLines, halfOverUnderLines };
	                  const games = Array.isArray(moreMarkets.game) ? moreMarkets.game : [moreMarkets.game];
	                  for (const game of games) {
	                    const gid = game.gid || game.GID || game.id;
	                    // 全场让球
	                    const ratio = game.ratio || game.RATIO_R || game.ratio_r;
	                    const iorRH = game.ior_RH || game.IOR_RH;
	                    const iorRC = game.ior_RC || game.IOR_RC;
	                    if (ratio && (iorRH || iorRC)) {
	                      handicapLines.push({ line: ratio, home: iorRH, away: iorRC, gid });
	                    }
	                    // 全场大小
	                    const ratioO = game.ratio_o || game.RATIO_OUO || game.ratio_ouo;
	                    const iorOUH = game.ior_OUH || game.IOR_OUH;
	                    const iorOUC = game.ior_OUC || game.IOR_OUC;
	                    if (ratioO && (iorOUH || iorOUC)) {
	                      overUnderLines.push({ line: ratioO, over: iorOUC, under: iorOUH, gid });
	                    }
	                    // 半场让球
	                    const hratio = game.hratio || game.RATIO_HR || game.ratio_hr;
	                    const iorHRH = game.ior_HRH || game.IOR_HRH;
	                    const iorHRC = game.ior_HRC || game.IOR_HRC;
	                    if (hratio && (iorHRH || iorHRC)) {
	                      halfHandicapLines.push({ line: hratio, home: iorHRH, away: iorHRC, gid });
	                    }
	                    // 半场大小
	                    const ratioHO = game.ratio_ho || game.RATIO_HOUO || game.ratio_houo;
	                    const iorHOUH = game.ior_HOUH || game.IOR_HOUH;
	                    const iorHOUC = game.ior_HOUC || game.IOR_HOUC;
	                    if (ratioHO && (iorHOUH || iorHOUC)) {
	                      halfOverUnderLines.push({ line: ratioHO, over: iorHOUC, under: iorHOUH, gid });
	                    }
	                  }
	                  return { handicapLines, overUnderLines, halfHandicapLines, halfOverUnderLines };
	                };

	                // 从 moreMarkets 提取盘口（如果存在）
	                const moreLines = extractLinesFromMoreMarkets(m.moreMarkets);

	                // 合并盘口：优先使用 markets.full.handicapLines，然后补充 moreMarkets 里的
	                const mergeLines = (existing: any[], incoming: any[]) => {
	                  if (!incoming.length) return existing;
	                  if (!existing.length) return incoming;
	                  const map = new Map<string, any>();
	                  for (const item of existing) {
	                    const key = String(item.line || item.hdp || '');
	                    map.set(key, item);
	                  }
	                  for (const item of incoming) {
	                    const key = String(item.line || item.hdp || '');
	                    // 如果已存在，合并（保留 gid）
	                    if (map.has(key)) {
	                      map.set(key, { ...map.get(key), ...item });
	                    } else {
	                      map.set(key, item);
	                    }
	                  }
	                  return Array.from(map.values());
	                };

	                const fullHdp = mergeLines(
	                  markets.full?.handicapLines || (markets.handicap ? [markets.handicap] : []),
	                  moreLines.handicapLines
	                );
	                const fullOu = mergeLines(
	                  markets.full?.overUnderLines || (markets.ou ? [markets.ou] : []),
	                  moreLines.overUnderLines
	                );

	                // 角球盘口（全场）：优先使用后端标准 markets.corners，其次兼容 WS 的 markets.cornerFull
	                const cornerFullSource = markets.corners || (markets as any).cornerFull || {};
	                const rawCornerFullHdp = cornerFullSource.handicapLines || [];
	                const rawCornerFullOu = cornerFullSource.overUnderLines || [];
	                const isFromWsCornerFull = !markets.corners && !!(markets as any).cornerFull;
	                const pickMainLines = (lines: any[]): any[] => {
	                  if (!Array.isArray(lines) || lines.length === 0) return [];
	                  const masters = lines.filter(
	                    (ln: any) => ln?.__meta?.isMaster === 'Y' || ln?.isMaster === 'Y',
	                  );
	                  if (masters.length > 0) return [masters[0]];
	                  return [lines[0]];
	                };
	                const cornerFullHdpBase = pickMainLines(rawCornerFullHdp);
	                const cornerFullOuBase = pickMainLines(rawCornerFullOu);
	                const cornerFullHdp = isFromWsCornerFull
	                  ? cornerFullHdpBase.map((line: any) => ({ ...line, __isCorner: true }))
	                  : cornerFullHdpBase;
	                const cornerFullOu = isFromWsCornerFull
	                  ? cornerFullOuBase.map((line: any) => ({ ...line, __isCorner: true }))
	                  : cornerFullOuBase;

	                // 用于展示的全场让球/大小 = 普通 + 角球（角球在下方）
	                const displayFullHdp = [...fullHdp, ...cornerFullHdp];
	                const displayFullOu = [...fullOu, ...cornerFullOu];

	                const halfHdpBase = mergeLines(
	                  markets.half?.handicapLines || (markets.half?.handicap ? [markets.half.handicap] : []),
	                  moreLines.halfHandicapLines
	                );
	                const halfOuBase = mergeLines(
	                  markets.half?.overUnderLines || (markets.half?.ou ? [markets.half.ou] : []),
	                  moreLines.halfOverUnderLines
	                );

	                // 角球盘口（半场）：兼容 WS 的 markets.cornerHalf（也只取一个主盘口）
	                const cornerHalfSource = (markets as any).cornerHalf || {};
	                const rawCornerHalfHdp = cornerHalfSource.handicapLines || [];
	                const rawCornerHalfOu = cornerHalfSource.overUnderLines || [];
	                const cornerHalfHdpBase = pickMainLines(rawCornerHalfHdp);
	                const cornerHalfOuBase = pickMainLines(rawCornerHalfOu);
	                const cornerHalfHdp = cornerHalfHdpBase.map((line: any) => ({
	                  ...line,
	                  __isCorner: true,
	                }));
	                const cornerHalfOu = cornerHalfOuBase.map((line: any) => ({
	                  ...line,
	                  __isCorner: true,
	                }));

	                // 半场盘口只显示 3 行，但要优先保证角球那一行在 3 行里
	                const selectWithCornerPriority = (lines: any[], max: number): any[] => {
	                  if (!Array.isArray(lines) || lines.length <= max) return lines;
	                  const corners = lines.filter((ln: any) => (ln as any).__isCorner);
	                  const normals = lines.filter((ln: any) => !(ln as any).__isCorner);
	                  const result: any[] = [];
	                  const normalLimit = corners.length ? max - 1 : max;
	                  result.push(...normals.slice(0, normalLimit));
	                  if (corners.length) result.push(corners[0]);
	                  return result.slice(0, max);
	                };

	                // 半场盘口 = 普通 + 角球
	                const halfHdp = [...halfHdpBase, ...cornerHalfHdp];
	                const halfOu = [...halfOuBase, ...cornerHalfOu];
                const fullMl = markets.moneyline || markets.full?.moneyline || {};
                const halfMl = markets.half?.moneyline || {};

                const liveClock = buildLiveClock(period, clock);
                let displayTime = liveClock;
                if (!displayTime) {
                  // 非滚球：只显示时间 HH:mm
                  const rawTime = m.time || '';
                  if (rawTime) {
                    // 如果已有时间格式如 "07:00" 或 "11-26 07:00"，提取时间部分
                    const timeMatch = rawTime.match(/(\d{1,2}:\d{2})/);
                    displayTime = timeMatch ? timeMatch[1] : rawTime;
                  } else if (m.match_time) {
                    try {
                      const date = new Date(m.match_time);
                      const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
                      const hours = String(chinaTime.getUTCHours()).padStart(2, '0');
                      const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0');
                      displayTime = `${hours}:${minutes}`;
                    } catch { displayTime = ''; }
                  }
                }

                return (
                  <div key={`${m.gid}-${idx}`} className="match-block">
                    {/* Left: Home Team */}
                    <div className="team-col team-home">{homeLabel}</div>

                    {/* Center: Match Info + Markets */}
                    <div className="match-center-block">
                      {/* Match Info Header */}
                      <div className="match-info-header">
                        <span className="league-name">{leagueLabel}</span>
                        {isMobile && (
                          <div className="mobile-teams-row">
                            <span className="mobile-team-home">{homeLabel}</span>
                            <span className="mobile-score">{scoreLabel || 'vs'}</span>
                            <span className="mobile-team-away">{awayLabel}</span>
                          </div>
                        )}
                        {!isMobile && scoreLabel && <span className="score-display">({scoreLabel})</span>}
                        <span className="time-display">{displayTime}</span>
                      </div>

                      {/* Markets Grid - Horizontal Layout */}
                      <div className="markets-grid">
                        {/* Full Moneyline */}
                        <div className="market-section">
                          <div className="market-title">独赢(1/2/X)</div>
                          <div className="market-odds-grid moneyline-grid">
                            <div className="odds-cell" onClick={() => fullMl.home && openBetModal(m, { bet_type: '独赢', bet_option: homeLabel, odds: fullMl.home, label: `[独赢] ${homeLabel} @${fullMl.home}`, market_category: 'moneyline', market_scope: 'full', market_side: 'home' })}>
                              {fullMl.home || '-'}
                            </div>
                            <div className="odds-cell" onClick={() => fullMl.away && openBetModal(m, { bet_type: '独赢', bet_option: awayLabel, odds: fullMl.away, label: `[独赢] ${awayLabel} @${fullMl.away}`, market_category: 'moneyline', market_scope: 'full', market_side: 'away' })}>
                              {fullMl.away || '-'}
                            </div>
                            <div className="odds-cell" onClick={() => fullMl.draw && openBetModal(m, { bet_type: '独赢', bet_option: '和局', odds: fullMl.draw, label: `[独赢] 和局 @${fullMl.draw}`, market_category: 'moneyline', market_scope: 'full', market_side: 'draw' })}>
                              {fullMl.draw || '-'}
                            </div>
                          </div>
                        </div>

                        {/* Full Handicap (含角球让球) */}
                        <div className="market-section">
                          <div className="market-title">让球(1/2)</div>
                          <div className="market-odds-grid handicap-grid">
                            {displayFullHdp.map((line: any, i: number) => {
                              const rawHdp = line.hdp ?? line.line;
                              const decimal = parseHandicapDecimal(rawHdp);
                              const baseLabel = decimal !== null ? formatHandicapValue(decimal) : rawHdp;
                              const isCorner = (line as any).__isCorner || (line as any).__meta?.mode === 'CN';
                              const displayHdp = isCorner ? `角球 ${baseLabel}` : baseLabel;
                              const lineGid = line.gid;  // 盘口专属 gid
                              return (
                                <React.Fragment key={i}>
                                  <div className="hdp-label-cell">{displayHdp}</div>
                                  <div className="odds-cell" onClick={() => line.home && openBetModal(m, { bet_type: isCorner ? '角球让球' : '让球', bet_option: `${homeLabel} (${displayHdp})`, odds: line.home, label: `[${isCorner ? '角球让球' : '让球'}] ${homeLabel} (${displayHdp}) @${line.home}`, market_category: 'handicap', market_scope: 'full', market_side: 'home', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'CNR' : undefined, market_rtype: isCorner ? 'CNRH' : undefined, spread_gid: lineGid })}>
                                    {line.home || '-'}
                                  </div>
                                  <div className="odds-cell" onClick={() => line.away && openBetModal(m, { bet_type: isCorner ? '角球让球' : '让球', bet_option: `${awayLabel} (${displayHdp})`, odds: line.away, label: `[${isCorner ? '角球让球' : '让球'}] ${awayLabel} (${displayHdp}) @${line.away}`, market_category: 'handicap', market_scope: 'full', market_side: 'away', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'CNR' : undefined, market_rtype: isCorner ? 'CNRC' : undefined, spread_gid: lineGid })}>
                                    {line.away || '-'}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>

                        {/* Full Over/Under (含角球大小) */}
                        <div className="market-section">
                          <div className="market-title">大小(O/U)</div>
                          <div className="market-odds-grid handicap-grid">
                            {displayFullOu.map((line: any, i: number) => {
                              const rawHdp = line.hdp ?? line.line;
                              const decimal = parseHandicapDecimal(rawHdp);
                              const baseLabel = decimal !== null
                                ? formatHandicapValue(Math.abs(decimal)).replace(/^[-+]/, '')
                                : rawHdp;
                              const isCorner = (line as any).__isCorner || (line as any).__meta?.mode === 'CN';
                              const displayHdp = isCorner ? `角球 ${baseLabel}` : baseLabel;
                              const lineGid = line.gid;  // 盘口专属 gid
                              return (
                                <React.Fragment key={i}>
                                  <div className="hdp-label-cell">{displayHdp}</div>
                                  <div className="odds-cell" onClick={() => line.over && openBetModal(m, { bet_type: isCorner ? '角球大小' : '大小', bet_option: `大 ${displayHdp}`, odds: line.over, label: `[${isCorner ? '角球大小' : '大小'}] 大 ${displayHdp} @${line.over}`, market_category: 'overunder', market_scope: 'full', market_side: 'over', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'CNOU' : undefined, market_rtype: isCorner ? 'CNOUC' : undefined, spread_gid: lineGid })}>
                                    {line.over || '-'}
                                  </div>
                                  <div className="odds-cell" onClick={() => line.under && openBetModal(m, { bet_type: isCorner ? '角球大小' : '大小', bet_option: `小 ${displayHdp}`, odds: line.under, label: `[${isCorner ? '角球大小' : '大小'}] 小 ${displayHdp} @${line.under}`, market_category: 'overunder', market_scope: 'full', market_side: 'under', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'CNOU' : undefined, market_rtype: isCorner ? 'CNOUH' : undefined, spread_gid: lineGid })}>
                                    {line.under || '-'}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>

                        {/* Half Moneyline */}
                        <div className="market-section">
                          <div className="market-title">独赢(半场)</div>
                          <div className="market-odds-grid moneyline-grid">
                            <div className="odds-cell" onClick={() => halfMl.home && openBetModal(m, { bet_type: '半场独赢', bet_option: homeLabel, odds: halfMl.home, label: `[半场独赢] ${homeLabel} @${halfMl.home}`, market_category: 'moneyline', market_scope: 'half', market_side: 'home', spread_gid: halfMl.gid })}>
                              {halfMl.home || '-'}
                            </div>
                            <div className="odds-cell" onClick={() => halfMl.away && openBetModal(m, { bet_type: '半场独赢', bet_option: awayLabel, odds: halfMl.away, label: `[半场独赢] ${awayLabel} @${halfMl.away}`, market_category: 'moneyline', market_scope: 'half', market_side: 'away', spread_gid: halfMl.gid })}>
                              {halfMl.away || '-'}
                            </div>
                            <div className="odds-cell" onClick={() => halfMl.draw && openBetModal(m, { bet_type: '半场独赢', bet_option: '和局', odds: halfMl.draw, label: `[半场独赢] 和局 @${halfMl.draw}`, market_category: 'moneyline', market_scope: 'half', market_side: 'draw', spread_gid: halfMl.gid })}>
                              {halfMl.draw || '-'}
                            </div>
                          </div>
                        </div>

                        {/* Half Handicap (含角球让球) */}
                        <div className="market-section">
                          <div className="market-title">让球(半场)</div>
                          <div className="market-odds-grid handicap-grid">
                            {halfHdp.map((line: any, i: number) => {
                              const rawHdp = line.hdp ?? line.line;
                              const decimal = parseHandicapDecimal(rawHdp);
                              const baseLabel = decimal !== null ? formatHandicapValue(decimal) : rawHdp;
                              const isCorner = (line as any).__isCorner || (line as any).__meta?.mode === 'CN';
                              const displayHdp = isCorner ? `角球 ${baseLabel}` : baseLabel;
                              const lineGid = line.gid;  // 盘口专属 gid
                              return (
                                <React.Fragment key={i}>
                                  <div className="hdp-label-cell">{displayHdp}</div>
                                  <div className="odds-cell" onClick={() => line.home && openBetModal(m, { bet_type: isCorner ? '半场角球让球' : '半场让球', bet_option: `${homeLabel} (${displayHdp})`, odds: line.home, label: `[${isCorner ? '半场角球让球' : '半场让球'}] ${homeLabel} (${displayHdp}) @${line.home}`, market_category: 'handicap', market_scope: 'half', market_side: 'home', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'HCNR' : undefined, market_rtype: isCorner ? 'HCNRH' : undefined, spread_gid: lineGid })}>
                                    {line.home || '-'}
                                  </div>
                                  <div className="odds-cell" onClick={() => line.away && openBetModal(m, { bet_type: isCorner ? '半场角球让球' : '半场让球', bet_option: `${awayLabel} (${displayHdp})`, odds: line.away, label: `[${isCorner ? '半场角球让球' : '半场让球'}] ${awayLabel} (${displayHdp}) @${line.away}`, market_category: 'handicap', market_scope: 'half', market_side: 'away', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'HCNR' : undefined, market_rtype: isCorner ? 'HCNRC' : undefined, spread_gid: lineGid })}>
                                    {line.away || '-'}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>

                        {/* Half Over/Under (含角球大小) */}
                        <div className="market-section">
                          <div className="market-title">大小(O/U半)</div>
                          <div className="market-odds-grid handicap-grid">
                            {halfOu.map((line: any, i: number) => {
                              const rawHdp = line.hdp ?? line.line;
                              const decimal = parseHandicapDecimal(rawHdp);
                              const baseLabel = decimal !== null
                                ? formatHandicapValue(Math.abs(decimal)).replace(/^[-+]/, '')
                                : rawHdp;
                              const isCorner = (line as any).__isCorner || (line as any).__meta?.mode === 'CN';
                              const displayHdp = isCorner ? `角球 ${baseLabel}` : baseLabel;
                              const lineGid = line.gid;  // 盘口专属 gid
                              return (
                                <React.Fragment key={i}>
                                  <div className="hdp-label-cell">{displayHdp}</div>
                                  <div className="odds-cell" onClick={() => line.over && openBetModal(m, { bet_type: isCorner ? '半场角球大小' : '半场大小', bet_option: `大 ${displayHdp}`, odds: line.over, label: `[${isCorner ? '半场角球大小' : '半场大小'}] 大 ${displayHdp} @${line.over}`, market_category: 'overunder', market_scope: 'half', market_side: 'over', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'HCNOU' : undefined, market_rtype: isCorner ? 'HCNOUC' : undefined, spread_gid: lineGid })}>
                                    {line.over || '-'}
                                  </div>
                                  <div className="odds-cell" onClick={() => line.under && openBetModal(m, { bet_type: isCorner ? '半场角球大小' : '半场大小', bet_option: `小 ${displayHdp}`, odds: line.under, label: `[${isCorner ? '半场角球大小' : '半场大小'}] 小 ${displayHdp} @${line.under}`, market_category: 'overunder', market_scope: 'half', market_side: 'under', market_line: rawHdp, market_index: i, market_wtype: isCorner ? 'HCNOU' : undefined, market_rtype: isCorner ? 'HCNOUH' : undefined, spread_gid: lineGid })}>
                                    {line.under || '-'}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Away Team */}
                    <div className="team-col team-away">{awayLabel}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Spin>
      </Card>
	      <BetFormModal
	        key={betModalKey}
	        visible={betModalVisible}
	        match={selectedMatch}
	        accounts={accounts}
	        defaultSelection={selectionPreset}
	        onCancel={closeBetModal}
	        onSubmit={async () => {
	          closeBetModal();
	          await fetchAccounts(true);
	          await loadMatches();
	        }}
	        getMatchSnapshot={getMatchSnapshot}
	      />
    </div>
  );
};

export default MatchesPage;
