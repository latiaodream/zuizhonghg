import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  Form,
  Select,
  InputNumber,
  Input,
  Row,
  Col,
  Space,
  Tag,
  Checkbox,
  message,
  Button,
  Spin,
  Empty,
  Tooltip,
} from 'antd';
import { TrophyOutlined, ReloadOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { Match, CrownAccount, BetCreateRequest, AccountSelectionResponse } from '../../types';
import { betApi, accountApi, crownApi } from '../../services/api';
import dayjs from 'dayjs';
import type { AxiosError } from 'axios';

const { Option } = Select;

export type MarketCategory = 'moneyline' | 'handicap' | 'overunder';
export type MarketScope = 'full' | 'half';
export type MarketSide = 'home' | 'away' | 'draw' | 'over' | 'under';

export interface SelectionMeta {
  bet_type: string;
  bet_option: string;
  odds: number | string;
  label?: string;
  market_category?: MarketCategory;
  market_scope?: MarketScope;
  market_side?: MarketSide;
  market_line?: string;
  market_index?: number;
  market_wtype?: string;
  market_rtype?: string;
  market_chose_team?: 'H' | 'C' | 'N';
  spread_gid?: string;  // 盘口专属 gid（用于副盘口）
  lid?: string;  // 联赛 ID
}

interface BetFormModalProps {
  visible: boolean;
  match: Match | null;
  accounts: CrownAccount[];
  onCancel: () => void;
  onSubmit: () => void;
  defaultSelection?: SelectionMeta | null;
  getMatchSnapshot?: (matchId: string | number | undefined | null) => any;
}

const BetFormModal: React.FC<BetFormModalProps> = ({
  visible,
  match,
  accounts,
  onCancel,
  onSubmit,
  defaultSelection,
  getMatchSnapshot,
}) => {
  const [form] = Form.useForm();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [loading, setLoading] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([]);
  const [estimatedPayout, setEstimatedPayout] = useState(0);
  const [selectionLabel, setSelectionLabel] = useState('');
  const [betMode, setBetMode] = useState<'优选' | '平均'>('优选');
  const [autoSelection, setAutoSelection] = useState<AccountSelectionResponse | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [oddsPreview, setOddsPreview] = useState<{ odds: number | null; closed: boolean; message?: string; spreadMismatch?: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [autoRefreshOdds, setAutoRefreshOdds] = useState(true); // 自动刷新赔率开关
	  // 弹窗拖拽相关状态（仅桌面端使用）
	  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
	  const [dragState, setDragState] = useState<{
	    dragging: boolean;
	    startX: number;
	    startY: number;
	    originX: number;
	    originY: number;
	  }>({ dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  // 监听表单值变化以触发重渲染
  const totalAmount = Form.useWatch('total_amount', form);
  const singleLimit = Form.useWatch('single_limit', form);
  const intervalRange = Form.useWatch('interval_range', form);
  const quantity = Form.useWatch('quantity', form);
  const minOdds = Form.useWatch('min_odds', form);

  const accountDict = useMemo(() => {
    const map = new Map<number, CrownAccount>();
    accounts.forEach(acc => map.set(acc.id, acc));
    return map;
  }, [accounts]);

  const selectionMeta = defaultSelection || undefined;
  const matchKey = match ? (match.crown_gid || match.gid || match.match_id || match.id) : null;
  const marketSnapshot = useMemo(() => {
    if (!matchKey) return match;
    if (!getMatchSnapshot) return match;
    return getMatchSnapshot(matchKey) || match;
  }, [matchKey, match, getMatchSnapshot]);

	  // 弹窗关闭时重置拖拽位移
	  useEffect(() => {
	    if (!visible) {
	      setDragOffset({ x: 0, y: 0 });
	      setDragState(prev => ({ ...prev, dragging: false, originX: 0, originY: 0, startX: 0, startY: 0 }));
	    }
	  }, [visible]);

  const getLineKey = useCallback((accountId: number): string => {
    const meta = autoSelection?.eligible_accounts.find(entry => entry.account.id === accountId)
      || autoSelection?.excluded_accounts.find(entry => entry.account.id === accountId);
    if (meta?.account.line_key) {
      return meta.account.line_key;
    }

    const account = accounts.find(item => item.id === accountId);
    const base = (account?.original_username || account?.username || '').trim();
    return base ? base.slice(0, 4).toUpperCase() : 'UNKNOWN';
  }, [accounts, autoSelection]);

  useEffect(() => {
    if (visible && match) {
      form.resetFields();
      setSelectedAccounts([]);
      setEstimatedPayout(0);
      const defaults = {
        bet_type: defaultSelection?.bet_type || '让球',
        bet_option: defaultSelection?.bet_option || '主队',
        odds: defaultSelection?.odds || 1.85,
      };
      setSelectionLabel(defaultSelection?.label || '');
      setAutoSelection(null);
      setAutoLoading(false);
      setOddsPreview(null);
      setPreviewError(null);
      // 设置默认值
      form.setFieldsValue({
        bet_type: defaults.bet_type,
        bet_option: defaults.bet_option,
        bet_amount: 100,
        odds: defaults.odds,
        single_limit: undefined,  // 默认为空，使用账号限额
        interval_seconds: 3,
        quantity: 1,
        min_odds: defaults.odds,
        total_amount: 100,
        interval_range: '1-3',
        group: undefined,
        account_ids: [],
      });
    }
  }, [visible, match, form, defaultSelection]);

  const isTruthy = (value: any): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      return ['1', 'true', 'TRUE', 'True', 'online', 'ONLINE'].includes(value.trim());
    }
    return !!value;
  };

  const accountMetaMap = useMemo(() => {
    const map = new Map<number, AccountSelectionResponse['eligible_accounts'][number]>();
    if (autoSelection) {
      autoSelection.eligible_accounts.forEach(entry => {
        map.set(entry.account.id, entry);
      });
      autoSelection.excluded_accounts.forEach(entry => {
        map.set(entry.account.id, entry);
      });
    }
    return map;
  }, [autoSelection]);

  const isAccountOnline = useCallback((accountId: number): boolean => {
    const meta = accountMetaMap.get(accountId);
    if (meta) {
      if (meta.flags?.offline) {
        return false;
      }
      if (meta.account && meta.account.is_online !== undefined) {
        return isTruthy(meta.account.is_online);
      }
    }

    const account = accountDict.get(accountId);
    if (account && account.is_online !== undefined) {
      return isTruthy(account.is_online);
    }

    return false;
  }, [accountMetaMap, accountDict]);

  const deriveOddsFromMarkets = useCallback(() => {
    if (!marketSnapshot || !selectionMeta) {
      return null;
    }

    const markets = marketSnapshot.markets || {};
    const scope: MarketScope = selectionMeta.market_scope || 'full';
    const category: MarketCategory | undefined = selectionMeta.market_category;
    const side: MarketSide | undefined = selectionMeta.market_side;
    const wtype = (selectionMeta.market_wtype || '').toUpperCase();

    // 判断是否是角球盘口
    const isCornerFull = wtype.startsWith('CN') && !wtype.startsWith('HCN'); // CNR, CNOU
    const isCornerHalf = wtype.startsWith('HCN'); // HCNR, HCNOU

    const normalizeLine = (value?: string | number | null) => {
      if (value === null || value === undefined) return undefined;
      return String(value).trim();
    };

    const normalizeGid = (value?: string | number | null) => {
      if (value === null || value === undefined) return undefined;
      return String(value).trim();
    };

    const toNumber = (value: any): number | null => {
      if (value === null || value === undefined || value === '') return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const pickLineEntry = (lines?: Array<{ line?: string; home?: string; away?: string; over?: string; under?: string; gid?: string; GID?: string }>): { entry: any | null; notFound: boolean } => {
      if (!Array.isArray(lines) || lines.length === 0) {
        return { entry: null, notFound: true };
      }

      const hasExplicitKey =
        selectionMeta.market_line !== undefined ||
        selectionMeta.market_index !== undefined ||
        selectionMeta.spread_gid !== undefined;

      // 1) 优先使用 spread_gid 精确匹配（针对多盘口的副盘口）
      if (selectionMeta.spread_gid) {
        const targetGid = normalizeGid(selectionMeta.spread_gid);
        const byGid = lines.find((item: any) => {
          const gid = (item as any).spread_gid || (item as any).gid || (item as any).GID || (item as any).id;
          return normalizeGid(gid) === targetGid;
        });
        if (byGid) {
          return { entry: byGid, notFound: false };
        }
      }

      // 2) 其次按盘口线字符串匹配
      if (selectionMeta.market_line !== undefined) {
        const target = normalizeLine(selectionMeta.market_line);
        const byLine = lines.find((item: any) => {
          const raw = (item as any).line ?? (item as any).hdp ?? (item as any).ratio;
          return normalizeLine(raw) === target;
        });
        if (byLine) {
          return { entry: byLine, notFound: false };
        }
      }

      // 3) 非角球盘口可以按索引兜底（数组位置未变化的情况）
      if (!isCornerFull && !isCornerHalf && selectionMeta.market_index !== undefined && Number.isFinite(selectionMeta.market_index)) {
        const idx = selectionMeta.market_index as number;
        if (idx >= 0 && idx < lines.length) {
          return { entry: lines[idx], notFound: false };
        }
      }

      if (hasExplicitKey) {
        // 用户是从某个具体盘口进来的，但当前盘口列表中已经找不到对应盘口：视为该盘口已关闭
        return { entry: null, notFound: true };
      }

      // 兼容老逻辑：没有任何定位信息时，退回主盘口
      return { entry: lines[0], notFound: false };
    };

    const buildResponse = (value: any, extra?: { closed?: boolean; message?: string }) => {
      const numeric = toNumber(value);
      return {
        odds: numeric,
        closed: !!extra?.closed,
        message: extra?.message || 'iSports 实时赔率',
      };
    };

    const buildClosedResponse = (reason?: string) => ({
      odds: null,
      closed: true,
      message: reason || '盘口已关闭',
    });

    if (category === 'moneyline') {
      const ml = scope === 'half'
        ? markets?.half?.moneyline || markets?.half?.moneyLine
        : markets.moneyline || markets.moneyLine;
      if (!ml) return null;
      const value = side === 'away' ? ml.away : side === 'draw' ? ml.draw : ml.home;
      return buildResponse(value);
    }

    if (category === 'handicap') {
      let lines: any[];
      if (isCornerFull) {
        // 全场角球让球：从 markets.corners 或 markets.cornerFull 取
        const cornerSource = markets?.corners || (markets as any)?.cornerFull || {};
        lines = cornerSource.handicapLines || (cornerSource.handicap ? [cornerSource.handicap] : []);
      } else if (isCornerHalf) {
        // 半场角球让球：从 markets.cornerHalf 取
        const cornerHalfSource = (markets as any)?.cornerHalf || {};
        lines = cornerHalfSource.handicapLines || (cornerHalfSource.handicap ? [cornerHalfSource.handicap] : []);
      } else if (scope === 'half') {
        // 普通半场让球
        lines = markets?.half?.handicapLines || (markets?.half?.handicap ? [markets.half.handicap] : []);
      } else {
        // 普通全场让球
        lines = markets?.full?.handicapLines || (markets?.handicap ? [markets.handicap] : []);
      }
      const { entry, notFound } = pickLineEntry(lines);
      if (!entry) {
        if (notFound) {
          return buildClosedResponse('盘口已关闭（未找到对应盘口）');
        }
        return null;
      }
      const value = side === 'away' ? entry.away : entry.home;
      return buildResponse(value);
    }

    if (category === 'overunder') {
      let lines: any[];
      if (isCornerFull) {
        // 全场角球大小：从 markets.corners 或 markets.cornerFull 取
        const cornerSource = markets?.corners || (markets as any)?.cornerFull || {};
        lines = cornerSource.overUnderLines || (cornerSource.ou ? [cornerSource.ou] : []);
      } else if (isCornerHalf) {
        // 半场角球大小：从 markets.cornerHalf 取
        const cornerHalfSource = (markets as any)?.cornerHalf || {};
        lines = cornerHalfSource.overUnderLines || (cornerHalfSource.ou ? [cornerHalfSource.ou] : []);
      } else if (scope === 'half') {
        // 普通半场大小
        lines = markets?.half?.overUnderLines || (markets?.half?.ou ? [markets.half.ou] : []);
      } else {
        // 普通全场大小
        lines = markets?.full?.overUnderLines || (markets?.ou ? [markets.ou] : []);
      }
      const { entry, notFound } = pickLineEntry(lines);
      if (!entry) {
        if (notFound) {
          return buildClosedResponse('盘口已关闭（未找到对应盘口）');
        }
        return null;
      }
      const value = side === 'under' ? entry.under : entry.over;
      return buildResponse(value);
    }

    return null;
  }, [marketSnapshot, selectionMeta]);

  const previewOddsRequest = useCallback(async (silent = false) => {
    if (!match) {
      setOddsPreview(null);
      setPreviewError(null);
      return { success: false };
    }

    const currentValues = form.getFieldsValue();

    // 先获取前端计算的赔率作为备用，但不立即设置到 oddsPreview
    const derived = deriveOddsFromMarkets();

    // 获取在线账号列表
    const onlineAccounts = accounts.filter(acc => isAccountOnline(acc.id));

    // 如果没有选择账号，使用第一个在线账号
    let accountId = selectedAccounts.length > 0 ? selectedAccounts[0] : null;
    if (!accountId && onlineAccounts.length > 0) {
      accountId = onlineAccounts[0].id;
    }

    if (!accountId) {
      // 没有在线账号时，使用前端计算的赔率
      if (derived) {
        setOddsPreview({
          odds: derived.odds ?? null,
	          closed: !!derived.closed,
	          message: derived.message,
        });
        if (derived.odds !== null) {
          form.setFieldValue('odds', derived.odds);
        }
      } else if (!silent) {
        setOddsPreview(null);
        setPreviewError('没有可用的在线账号');
      }
      return { success: false, message: '没有可用的在线账号' };
    }

    const betTypeValue = currentValues.bet_type ?? defaultSelection?.bet_type ?? '让球';
    const betOptionValue = currentValues.bet_option ?? defaultSelection?.bet_option ?? '主队';
    const oddsValue = currentValues.odds ?? defaultSelection?.odds ?? 1;

	    const payload = {
	      account_id: accountId,
	      match_id: match.id,
	      crown_match_id: match.crown_gid || match.gid || match.match_id,
	      bet_type: betTypeValue,
	      bet_option: betOptionValue,
	      odds: oddsValue,
	      bet_amount: currentValues.bet_amount ?? 0,
	      league_name: match.league_name,
	      home_team: match.home_team,
	      away_team: match.away_team,
	      match_time: match.match_time,
	      match_status: match.status,
	      current_score: match.current_score,
	      match_period: match.match_period,
	      market_category: selectionMeta?.market_category,
	      market_scope: selectionMeta?.market_scope,
	      market_side: selectionMeta?.market_side,
	      market_line: selectionMeta?.market_line,
	      market_index: selectionMeta?.market_index,
	      market_wtype: selectionMeta?.market_wtype,
	      market_rtype: selectionMeta?.market_rtype,
	      market_chose_team: selectionMeta?.market_chose_team,
	      spread_gid: selectionMeta?.spread_gid,  // 盘口专属 gid
	      lid: selectionMeta?.lid,  // 联赛 ID（用于 get_game_more 查询副盘口）
	    };

    if (!silent) {
      setPreviewLoading(true);
    }

    try {
      const response = await crownApi.previewOdds(payload);
      if (response.success && response.data) {
        const previewData = response.data;

        // 检查盘口线是否匹配（仅记录警告，不阻止下注）
        if (previewData.spread_mismatch) {
          console.warn('⚠️ Crown API 返回的盘口线与用户选择不匹配:', {
            requested: previewData.requested_line,
            returned: previewData.returned_spread,
          });
          // 即使盘口线不完全匹配，仍然使用返回的赔率继续下注
          // 因为皇冠的盘口格式可能与前端显示不同（如 "0 / 0.5" vs "0.25"）
        }

        setOddsPreview({
          odds: previewData.odds ?? null,
          closed: !!previewData.closed,
          message: previewData.message,
        });
        if (previewData.closed) {
          setPreviewError(previewData.message || '盘口已封盘或暂时不可投注');
        } else {
          setPreviewError(null);
        }
        // 更新表单中的赔率
        if (previewData.odds !== null && previewData.odds !== undefined) {
          form.setFieldValue('odds', previewData.odds);
        }
        return { success: true, data: previewData };
      }

	      const msg = response.error || response.message || '获取赔率失败';
	      if (!silent) {
	        setPreviewError(msg);
	      }
	      if (response.data?.closed) {
	        setOddsPreview({
	          odds: response.data.odds ?? null,
	          closed: true,
	          message: msg,
	        });
      } else if (derived) {
        setOddsPreview({
          odds: derived.odds ?? null,
          closed: !!derived.closed,
          message: derived.message || '本地盘口赔率（皇冠预览失败）',
        });
	        if (derived.odds !== null && derived.odds !== undefined) {
	          form.setFieldValue('odds', derived.odds);
	        }
	      } else {
	        setOddsPreview(null);
	      }
	      return { success: false, message: msg, data: response.data };
    } catch (error: any) {
	      const msg = error?.response?.data?.error || error?.message || '获取赔率失败';
	      if (!silent) {
	        setPreviewError(msg);
	      }
      if (derived) {
        setOddsPreview({
          odds: derived.odds ?? null,
          closed: !!derived.closed,
          message: derived.message || '本地盘口赔率（皇冠预览失败）',
        });
	        if (derived.odds !== null && derived.odds !== undefined) {
	          form.setFieldValue('odds', derived.odds);
	        }
	      } else {
	        setOddsPreview(null);
	      }
	      return { success: false, message: msg };
    } finally {
      if (!silent) {
        setPreviewLoading(false);
      }
    }
  }, [match, selectedAccounts, form, defaultSelection, accounts, isAccountOnline, deriveOddsFromMarkets]);

		  // 使用 WSS 推送的盘口数据实时刷新赔率显示：
		  // 不再轮询调用皇冠预览接口，避免频繁请求 transform.php。
		  useEffect(() => {
		    if (!visible || !autoRefreshOdds) return;
		
		    const derived = deriveOddsFromMarkets();
		    if (!derived) return;
		
		    setOddsPreview((prev) => ({
		      odds: derived.odds ?? null,
		      closed: derived.closed ?? prev?.closed ?? false,
		      message: derived.message,
		      spreadMismatch: prev?.spreadMismatch,
		    }));
		
		    if (derived.odds !== null && derived.odds !== undefined) {
		      form.setFieldValue('odds', derived.odds);
		    }
		  }, [visible, autoRefreshOdds, deriveOddsFromMarkets, form]);

  const fetchAutoSelection = useCallback(async (limit?: number, silent = false) => {
    if (!match) return;

    try {
      setAutoLoading(true);
      const response = await accountApi.autoSelect({ match_id: match.id, limit });
      if (!response.success || !response.data) {
        if (!silent) {
          message.error(response.error || '优选账号失败');
        }
        return;
      }

      setAutoSelection(response.data);

      const usedLines = new Set<string>();
      const recommended: number[] = [];
      response.data.eligible_accounts.forEach((entry) => {
        if (entry.flags?.offline) {
          return;
        }
        const fallbackOnline = accountDict.get(entry.account.id)?.is_online;
        const entryOnline = entry.account.is_online !== undefined
          ? isTruthy(entry.account.is_online)
          : isTruthy(fallbackOnline);
        if (!entryOnline) {
          return;
        }
        const lineKey = entry.account.line_key || 'UNKNOWN';
        if (usedLines.has(lineKey)) {
          return;
        }
        usedLines.add(lineKey);
        recommended.push(entry.account.id);
      });
      const skippedCount = response.data.eligible_accounts.length - recommended.length;
      if (recommended.length === 0) {
        setSelectedAccounts([]);
        form.setFieldValue('account_ids', []);
        if (!silent) {
          message.warning('当前无符合条件的在线账号');
        }
        return;
      }

      setSelectedAccounts(recommended);
      form.setFieldValue('account_ids', recommended);
      calculatePayout(recommended.length);
      // 当启用“自动”实时赔率时，优先依赖 WSS 推送，不主动调皇冠预览
      if (!autoRefreshOdds) {
        setTimeout(() => {
          previewOddsRequest(true);
        }, 0);
      }

      if (!silent) {
        const baseMsg = `已优选 ${recommended.length} 个在线账号`;
        message.success(skippedCount > 0 ? `${baseMsg}（自动跳过 ${skippedCount} 个同线路账号）` : baseMsg);
      }
    } catch (error) {
      console.error('Auto select accounts failed:', error);
      if (!silent) {
        message.error('优选账号失败');
      }
    } finally {
      setAutoLoading(false);
    }
  }, [form, match, accountDict, previewOddsRequest, autoRefreshOdds]);

  const matchId = match?.id;
  useEffect(() => {
    if (!visible || !matchId) return;
    // 弹窗打开时自动优选账号（静默模式，不显示提示）
    fetchAutoSelection(undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, matchId]);

  const handleAccountsChange = (accountIds: Array<number | string>) => {
    const normalized = accountIds.map(id => Number(id));
    setSelectedAccounts(normalized);
    form.setFieldValue('account_ids', normalized);
    calculatePayout(normalized.length);
    // 自动实时赔率开启时，依赖 WSS，不主动请求皇冠预览接口
    if (!autoRefreshOdds) {
      setTimeout(() => {
        previewOddsRequest(true);
      }, 0);
    }
  };

  const calculatePayout = (accountCountOverride?: number) => {
    const totalAmount = form.getFieldValue('total_amount') || 0;
    const odds = form.getFieldValue('odds') || 1;

    // 预估盈利 = 总金额 × 赔率
    const payout = totalAmount * odds;
    setEstimatedPayout(payout);
  };

  const handleFormValuesChange = () => {
    calculatePayout();
    // 自动实时赔率开启时，赔率展示由 WSS 驱动；关闭时才调用皇冠预览接口
    if (!autoRefreshOdds) {
      previewOddsRequest(true);
    }
  };

  const handleModeSwitch = (mode: '优选' | '平均') => {
    setBetMode(mode);
    if (mode === '优选') {
      fetchAutoSelection(undefined, true);
    }
  };

  const handleSubmit = async () => {
    if (!match) return;

    try {
      const values = await form.validateFields();

      const betTypeValue = values.bet_type ?? defaultSelection?.bet_type ?? '让球';
      const betOptionValue = values.bet_option ?? defaultSelection?.bet_option ?? '主队';
      const oddsValue = values.odds ?? defaultSelection?.odds ?? 1;

      const usedLines = new Set<string>();
      const conflictAccounts: number[] = [];
      selectedAccounts.forEach((accountId) => {
        const lineKey = getLineKey(accountId);
        if (usedLines.has(lineKey)) {
          conflictAccounts.push(accountId);
          return;
        }
        usedLines.add(lineKey);
      });

      if (conflictAccounts.length > 0) {
        const conflictLabels = conflictAccounts
          .map(id => accounts.find(acc => acc.id === id)?.username || String(id))
          .join('、');
        message.error(`所选账号存在同线路冲突：${conflictLabels}。每个线路同场只能下注一次。`);
        return;
      }

      setLoading(true);

      const previewCheck = await previewOddsRequest(true);
      if (!previewCheck.success) {
        message.error(previewCheck.message || '获取最新赔率失败，请稍后再试');
        setLoading(false);
        return;
      }

      if (previewCheck.data?.closed) {
        message.error(previewCheck.data.message || '盘口已封盘或暂时不可投注');
        setLoading(false);
        return;
      }

      const latestOddsValue = previewCheck.data?.odds;
      const finalOdds = typeof latestOddsValue === 'number' && Number.isFinite(latestOddsValue)
        ? latestOddsValue
        : oddsValue;

      // 调试日志：检查 selectionMeta 的值
      console.log('🔍 下注参数 selectionMeta:', {
        market_category: selectionMeta?.market_category,
        market_scope: selectionMeta?.market_scope,
        market_side: selectionMeta?.market_side,
        market_line: selectionMeta?.market_line,
        market_index: selectionMeta?.market_index,
      });

      const requestData: BetCreateRequest = {
        account_ids: selectedAccounts,
        match_id: match.id,
        bet_type: betTypeValue,
        bet_option: betOptionValue,
        total_amount: values.total_amount,
        odds: finalOdds,
        single_limit: values.single_limit,
        interval_range: values.interval_range,
        quantity: values.quantity,
        min_odds: values.min_odds,
        crown_match_id: match.crown_gid || match.gid || match.match_id,
        league_name: match.league_name,
        home_team: match.home_team,
        away_team: match.away_team,
        match_time: match.match_time,
        match_status: match.status,
        current_score: match.current_score,
        match_period: match.match_period,
        market_category: selectionMeta?.market_category,
        market_scope: selectionMeta?.market_scope,
        market_side: selectionMeta?.market_side,
        market_line: selectionMeta?.market_line,
        market_index: selectionMeta?.market_index,
        market_wtype: selectionMeta?.market_wtype,
        market_rtype: selectionMeta?.market_rtype,
        market_chose_team: selectionMeta?.market_chose_team,
        spread_gid: selectionMeta?.spread_gid,  // 盘口专属 gid
      };

      const response = await betApi.createBet(requestData);
      if (response.success) {
        message.success(`成功为 ${selectedAccounts.length} 个账号创建下注`);
        onSubmit();
      } else {
        // 显示详细的错误信息
        const data = response.data as any;
        if (data?.failed && data.failed.length > 0) {
          // 显示每个失败账号的错误原因
          const errorMessages = data.failed.map((f: any) => {
            const accountName = accounts.find(a => a.id === f.accountId)?.username || `账号${f.accountId}`;
            return `${accountName}: ${f.error}`;
          }).join('\n');

          message.error({
            content: (
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>下注失败</div>
                <div style={{ whiteSpace: 'pre-line', fontSize: '13px' }}>{errorMessages}</div>
              </div>
            ),
            duration: 8,
          });
        } else {
          const errMsg = response.error || response.message || '创建下注失败';
          message.error(errMsg);
        }
      }
    } catch (error) {
      console.error('Failed to create bet:', error);
      const axiosError = error as AxiosError<{ error?: string; message?: string; data?: any }>;
      const responseData = axiosError.response?.data as any;
      
      // 检查是否有详细的失败信息
      if (responseData?.data?.failed && responseData.data.failed.length > 0) {
        const errorMessages = responseData.data.failed.map((f: any) => {
          const accountName = accounts.find(a => a.id === f.accountId)?.username || `账号${f.accountId}`;
          return `${accountName}: ${f.error}`;
        }).join('\n');
        
        message.error({
          content: (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{responseData.message || '下注失败'}</div>
              <div style={{ whiteSpace: 'pre-line', fontSize: '13px' }}>{errorMessages}</div>
            </div>
          ),
          duration: 8,
        });
      } else {
        const serverMessage = responseData?.error || responseData?.message || axiosError.message;
        message.error(serverMessage || '创建下注失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setSelectedAccounts([]);
    setEstimatedPayout(0);
    setSelectionLabel('');
    setBetMode('优选');
    setAutoSelection(null);
    setAutoLoading(false);
    onCancel();
  };

  const matchTimeLabel = useMemo(() => {
    if (!match) {
      return '-';
    }
    return dayjs(match.match_time).isValid()
      ? dayjs(match.match_time).format('YYYY-MM-DD HH:mm')
      : (match.match_time || '-');
  }, [match]);

  const recommendedOrder = useMemo(() => (
    autoSelection ? autoSelection.eligible_accounts.map(entry => entry.account.id) : []
  ), [autoSelection]);

  const sortedAccounts = useMemo(() => {
    // 只显示符合下注条件的账号（在线、未达止盈、无线路冲突）
    // 必须等待后端返回的优选结果，不再使用备用逻辑
    if (!autoSelection) {
      // 如果还没有优选数据，返回空数组（等待加载）
      return [];
    }

    const eligibleAccountIds = new Set<number>();
    autoSelection.eligible_accounts.forEach(entry => {
      eligibleAccountIds.add(entry.account.id);
    });

    const eligibleAccounts = accounts.filter(account =>
      eligibleAccountIds.has(account.id)
    );

    if (!recommendedOrder.length) {
      return eligibleAccounts;
    }
    const orderMap = new Map<number, number>();
    recommendedOrder.forEach((id, index) => orderMap.set(id, index));
    return [...eligibleAccounts].sort((a, b) => {
      const rankA = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.POSITIVE_INFINITY;
      const rankB = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.POSITIVE_INFINITY;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return a.username.localeCompare(b.username);
    });
  }, [accounts, recommendedOrder, autoSelection]);

  const formatAmount = (value: number) => {
    if (!Number.isFinite(value)) {
      return '-';
    }
    return value.toLocaleString();
  };

	  // 弹窗拖拽相关事件，只在桌面端生效
	  const handleModalMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
	    if (isMobile) return;
	    const target = e.target as HTMLElement | null;
	    // 只有按在标题区域（match 信息头部）时才开始拖动
	    if (!target || !target.closest('.bet-v2-header')) return;
	    setDragState({
	      dragging: true,
	      startX: e.clientX,
	      startY: e.clientY,
	      originX: dragOffset.x,
	      originY: dragOffset.y,
	    });
	  };

	  const handleModalMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
	    if (isMobile) return;
	    if (!dragState.dragging) return;
	    const deltaX = e.clientX - dragState.startX;
	    const deltaY = e.clientY - dragState.startY;
	    setDragOffset({
	      x: dragState.originX + deltaX,
	      y: dragState.originY + deltaY,
	    });
	  };

	  const handleModalMouseUp = () => {
	    if (dragState.dragging) {
	      setDragState(prev => ({ ...prev, dragging: false }));
	    }
	  };

	  return (
	    <Modal
      title={null}
      open={visible}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      width={isMobile ? '100%' : 480}
      style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw', padding: 0 } : undefined}
	      maskClosable={false}
	      className="bet-modal-v2"
	      modalRender={(origin) => (
	        <div
	          onMouseDown={handleModalMouseDown}
	          onMouseMove={handleModalMouseMove}
	          onMouseUp={handleModalMouseUp}
	          onMouseLeave={handleModalMouseUp}
	          style={{
	            transform: isMobile ? undefined : `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
	            cursor: !isMobile && dragState.dragging ? 'move' : 'default',
	          }}
	        >
	          {origin}
	        </div>
	      )}
      footer={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={handleCancel} style={{ flex: 1 }}>取消</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading} style={{ flex: 2 }}>
            确认下注 ({selectedAccounts.length}个账号)
          </Button>
        </div>
      }
    >
      {match ? (
        <div className="bet-v2">
          {/* 隐藏字段 */}
          <Form form={form} onValuesChange={handleFormValuesChange} style={{ display: 'none' }}>
            <Form.Item name="bet_type"><Input /></Form.Item>
            <Form.Item name="bet_option"><Input /></Form.Item>
            <Form.Item name="odds"><InputNumber /></Form.Item>
            <Form.Item name="account_ids"><Input /></Form.Item>
            <Form.Item name="total_amount"><InputNumber /></Form.Item>
            <Form.Item name="single_limit"><Input /></Form.Item>
            <Form.Item name="interval_range"><Input /></Form.Item>
            <Form.Item name="quantity"><InputNumber /></Form.Item>
            <Form.Item name="min_odds"><InputNumber /></Form.Item>
          </Form>

          {/* 比赛信息头部 */}
          <div className="bet-v2-header">
            <div className="bet-v2-match">
              <span className="teams">{match.home_team} vs {match.away_team}</span>
              {match.current_score && <span className="score">{match.current_score}</span>}
            </div>
            <div className="bet-v2-meta">
              <span>{match.league_name}</span>
              <span>{matchTimeLabel}</span>
            </div>
          </div>

          {/* 赔率显示 */}
          <div className="bet-v2-odds">
            <div className="odds-main">
              <span className="odds-label">{selectionLabel || '当前赔率'}</span>
              <span className={`odds-value ${oddsPreview?.closed ? 'closed' : ''} ${minOdds && oddsPreview?.odds && oddsPreview.odds < minOdds ? 'below-min' : ''}`}>
                {oddsPreview ? (oddsPreview.odds ?? '-') : '--'}
              </span>
              {previewLoading && <Spin size="small" />}
            </div>
            <div className="odds-actions">
              <Button size="small" icon={<ReloadOutlined />} onClick={() => previewOddsRequest(false)} />
              <Checkbox checked={autoRefreshOdds} onChange={(e) => setAutoRefreshOdds(e.target.checked)}>
                <span style={{ fontSize: 11 }}>自动</span>
              </Checkbox>
            </div>
            {/* 官方提示信息（封盘、错误等） */}
            {oddsPreview?.closed && (
              <div className="odds-closed">🚫 {oddsPreview.message || '盘口已封盘'}</div>
            )}
            {previewError && !oddsPreview?.closed && <div className="odds-error">{previewError}</div>}
            {minOdds && oddsPreview?.odds && oddsPreview.odds < minOdds && !oddsPreview?.closed && (
              <div className="odds-warning">当前赔率 {oddsPreview.odds} 低于最低赔率 {minOdds}</div>
            )}
          </div>

          {/* 表单区域 - 紧凑网格 */}
          <div className="bet-v2-form">
            <div className="form-grid">
              <div className="form-cell">
                <label>总金额</label>
                <InputNumber
                  size="small"
                  min={50}
                  style={{ width: '100%' }}
                  placeholder="50000"
                  value={totalAmount}
                  onChange={(v) => { form.setFieldValue('total_amount', v); handleFormValuesChange(); }}
                />
              </div>
              <div className="form-cell">
                <label>单笔限额</label>
                <Input
                  size="small"
                  placeholder="留空自动"
                  value={singleLimit}
                  onChange={(e) => form.setFieldValue('single_limit', e.target.value)}
                />
              </div>
              <div className="form-cell">
                <label>间隔(秒)</label>
                <Input
                  size="small"
                  placeholder="3-15"
                  value={intervalRange}
                  onChange={(e) => form.setFieldValue('interval_range', e.target.value)}
                />
              </div>
              <div className="form-cell">
                <label>数量</label>
                <InputNumber
                  size="small"
                  min={1}
                  max={10}
                  style={{ width: '100%' }}
                  value={quantity}
                  onChange={(v) => form.setFieldValue('quantity', v)}
                />
              </div>
              <div className="form-cell">
                <label>最低赔率</label>
                <InputNumber
                  size="small"
                  min={0}
                  step={0.01}
                  style={{ width: '100%' }}
                  placeholder="可选"
                  value={minOdds}
                  onChange={(v) => form.setFieldValue('min_odds', v)}
                />
              </div>
              <div className="form-cell">
                <label>模式</label>
                <div className="mode-switch">
                  {(['优选', '平均'] as const).map(mode => (
                    <span
                      key={mode}
                      className={mode === betMode ? 'active' : ''}
                      onClick={() => handleModeSwitch(mode)}
                    >{mode}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 账号选择 */}
          <div className="bet-v2-accounts">
            <div className="accounts-header">
              <span>账号 <b>{selectedAccounts.length}</b>/{sortedAccounts.length}</span>
              <Space size={4}>
                {betMode === '优选' && (
                  <Button type="link" size="small" onClick={() => fetchAutoSelection()} disabled={autoLoading} style={{ padding: 0, fontSize: 11 }}>
                    重选
                  </Button>
                )}
                {autoLoading && <Spin size="small" />}
              </Space>
            </div>
            <div className="accounts-list">
              {autoLoading && !autoSelection ? (
                <div style={{ padding: '12px', textAlign: 'center', color: '#999', fontSize: 12 }}>
                  <Spin size="small" /> 加载中...
                </div>
              ) : sortedAccounts.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: '#999', fontSize: 12 }}>
                  暂无可下注的账号
                </div>
              ) : (
                sortedAccounts.map(account => {
                  const selected = selectedAccounts.includes(account.id);
                  const online = isAccountOnline(account.id);
                  return (
                    <div
                      key={account.id}
                      className={`account-item ${selected ? 'selected' : ''} ${online ? '' : 'offline'}`}
                      onClick={() => {
                        if (!online) return;
                        const newSelected = selected
                          ? selectedAccounts.filter(id => id !== account.id)
                          : [...selectedAccounts, account.id];
                        handleAccountsChange(newSelected);
                      }}
                    >
                      <span className="name">{account.username}</span>
                      <span className={`status ${online ? 'on' : 'off'}`}>{online ? '✓' : '✗'}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : (
        <Empty description="请选择比赛" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 20 }} />
      )}
    </Modal>
  );
};

export default BetFormModal;
