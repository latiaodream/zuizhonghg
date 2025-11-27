import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Input,
  message,
  Empty,
  Typography,
  Select,
  Spin
} from 'antd';
import {
  ReloadOutlined
} from '@ant-design/icons';
import oddsApiService from '../services/oddsapi.service';
import type { OddsApiEvent } from '../types/oddsapi.types';
import dayjs from 'dayjs';

const { Title } = Typography;

const OddsApiMatchesPage: React.FC = () => {
  const [showtype, setShowtype] = useState<'live' | 'today' | 'early'>('live');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [events, setEvents] = useState<OddsApiEvent[]>([]);
  const [search, setSearch] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 加载赛事列表
  const loadEvents = async () => {
    setLoading(true);
    try {
      // 根据 showtype 确定状态
      let status: string;
      if (showtype === 'live') {
        status = 'live';
      } else {
        status = 'pending';
      }

      const response = await oddsApiService.getEvents({
        sport: 'football',
        status: status,
        limit: 500
      });

      if (response.success) {
        setEvents(response.data);
      }
    } catch (error: any) {
      console.error('加载赛事失败:', error);
      message.error('加载赛事失败');
    } finally {
      setLoading(false);
    }
  };

  // 手动同步数据
  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await oddsApiService.syncData('football');
      if (response.success) {
        message.success('数据同步已启动，请稍后刷新查看');
        setTimeout(() => {
          loadEvents();
        }, 3000);
      }
    } catch (error: any) {
      console.error('同步失败:', error);
      message.error('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [showtype]);

  // 过滤赛事：根据 showtype 和搜索关键词
  const filtered = useMemo(() => {
    const now = dayjs();
    const tomorrowNoon = now.add(1, 'day').startOf('day').add(12, 'hour'); // 明天中午12点
    const earlyStart = tomorrowNoon.add(1, 'second'); // 明天中午12点之后

    // 首先根据 showtype 过滤
    let result = events;

    if (showtype === 'live') {
      // 滚球：进行中的比赛
      result = events.filter(e => e.status === 'live');
    } else if (showtype === 'today') {
      // 今日：现在到明天中午12点之间未开始的比赛
      result = events.filter(e => {
        const matchTime = dayjs(e.date);
        return e.status === 'pending' && matchTime.isAfter(now) && matchTime.isBefore(tomorrowNoon);
      });
    } else if (showtype === 'early') {
      // 早盘：明天中午12点之后的比赛
      result = events.filter(e => {
        const matchTime = dayjs(e.date);
        return e.status === 'pending' && matchTime.isAfter(earlyStart);
      });
    }

    // 只显示有 Crown 赔率的比赛
    result = result.filter(e => e.odds && e.odds.length > 0);

    // 然后根据搜索关键词过滤
    if (!search.trim()) return result;
    const k = search.trim().toLowerCase();
    return result.filter((e: any) => {
      const leagueLabel = (e as any).league_name_zh || e.league_name;
      const homeLabel = (e as any).home_zh || e.home;
      const awayLabel = (e as any).away_zh || e.away;
      return [leagueLabel, homeLabel, awayLabel].some((v: any) => String(v || '').toLowerCase().includes(k));
    });
  }, [events, showtype, search]);

  // 渲染独赢赔率
  const renderMoneylineV2 = (event: OddsApiEvent) => {
    const mlOdds = event.odds?.find(o => o.market_name === 'ML');
    if (!mlOdds || (!mlOdds.ml_home && !mlOdds.ml_draw && !mlOdds.ml_away)) {
      return <div className="no-odds">-</div>;
    }

    return (
      <div className="moneyline-row-v2">
        <span className={`odds-value ${!mlOdds.ml_home ? 'empty' : ''}`}>
          {mlOdds.ml_home?.toFixed(2) || '-'}
        </span>
        <span className={`odds-value ${!mlOdds.ml_draw ? 'empty' : ''}`}>
          {mlOdds.ml_draw?.toFixed(2) || '-'}
        </span>
        <span className={`odds-value ${!mlOdds.ml_away ? 'empty' : ''}`}>
          {mlOdds.ml_away?.toFixed(2) || '-'}
        </span>
      </div>
    );
  };

  // 渲染让球赔率
  const renderHandicapV2 = (event: OddsApiEvent) => {
    const spreadOdds = event.odds?.find(o => o.market_name === 'Spread');
    if (!spreadOdds || spreadOdds.spread_hdp === null) {
      return <div className="no-odds">-</div>;
    }

    return (
      <div className="lines-table-v2">
        <div className="line-row-v2">
          <span className="line-label">{spreadOdds.spread_hdp}</span>
          <span className={`odds-value ${!spreadOdds.spread_home ? 'empty' : ''}`}>
            {spreadOdds.spread_home?.toFixed(2) || '-'}
          </span>
          <span className={`odds-value ${!spreadOdds.spread_away ? 'empty' : ''}`}>
            {spreadOdds.spread_away?.toFixed(2) || '-'}
          </span>
        </div>
      </div>
    );
  };

  // 渲染大小球赔率
  const renderOverUnderV2 = (event: OddsApiEvent) => {
    const totalsOdds = event.odds?.find(o => o.market_name === 'Totals');
    if (!totalsOdds || totalsOdds.totals_hdp === null) {
      return <div className="no-odds">-</div>;
    }

    return (
      <div className="lines-table-v2">
        <div className="line-row-v2">
          <span className="line-label">{totalsOdds.totals_hdp}</span>
          <span className={`odds-value ${!totalsOdds.totals_over ? 'empty' : ''}`}>
            {totalsOdds.totals_over?.toFixed(2) || '-'}
          </span>
          <span className={`odds-value ${!totalsOdds.totals_under ? 'empty' : ''}`}>
            {totalsOdds.totals_under?.toFixed(2) || '-'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="matches-page" style={{ padding: isMobile ? 0 : undefined }}>
      {!isMobile && <Title level={2}>Odds-API 赛事中心</Title>}

      <Card
        className="matches-filter-card"
        bodyStyle={{ padding: isMobile ? 8 : 14 }}
        style={isMobile ? { marginBottom: 1, borderRadius: 0 } : {}}
      >
        <div className="filter-grid" style={{ flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : undefined }}>
          <div className="filter-left" style={{ width: isMobile ? '100%' : undefined }}>
            <div className="filter-group" style={{ flexWrap: 'wrap', gap: 4 }}>
              <Select
                size="small"
                value={showtype}
                onChange={(v) => setShowtype(v as any)}
                style={{ width: isMobile ? 70 : undefined }}
                options={[
                  { label: '滚球', value: 'live' },
                  { label: '今日', value: 'today' },
                  { label: '早盘', value: 'early' },
                ]}
              />
            </div>
            <div className="matches-meta" style={{ fontSize: isMobile ? 12 : undefined }}>
              当前赛事：{filtered.length} 场
            </div>
          </div>
          <div className="filter-group filter-actions" style={{ width: isMobile ? '100%' : undefined, justifyContent: isMobile ? 'space-between' : undefined }}>
            <Input
              size="small"
              allowClear
              placeholder={isMobile ? '搜索' : '搜索联赛/球队'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: isMobile ? '60%' : undefined }}
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => loadEvents()}>
              {isMobile ? '' : '刷新'}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="matches-card" style={isMobile ? { marginBottom: 0, borderRadius: 0 } : {}}>
        <Spin spinning={loading} tip="加载中..." delay={200}>
          {filtered.length === 0 ? (
            <Empty description="暂无赛事" />
          ) : (
            <div className="compact-matches-table">
              {filtered.map((event, idx) => {
                const leagueLabel = (event as any).league_name_zh || event.league_name;
                const homeLabel = (event as any).home_zh || event.home;
                const awayLabel = (event as any).away_zh || event.away;

                let timeLabel = '';
                try {
                  const date = new Date(event.date);
                  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
                  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
                  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
                  const hours = String(chinaTime.getUTCHours()).padStart(2, '0');
                  const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0');
                  timeLabel = `${month}-${day} ${hours}:${minutes}`;
                } catch {
                  timeLabel = event.date;
                }

                const scoreMain = event.status === 'live' ? `${event.home_score}-${event.away_score}` : '';
                const scoreSub = event.status === 'live' ? '进行中' : timeLabel;
                const leagueDisplay = scoreMain ? `${leagueLabel}(${scoreMain})` : leagueLabel;

                return (
                  <div
                    key={`${event.id}-${idx}`}
                    className="compact-match-card-v2"
                  >
                    {/* 卡片头部：主队 + 联赛(时间) + 客队 */}
                    <div className="match-header-v2">
                      <div className="header-home">{homeLabel}</div>
                      <div className="header-center">
                        <div className="header-league">⭐ {leagueDisplay}</div>
                        <div className="header-time">{scoreSub}</div>
                      </div>
                      <div className="header-away">{awayLabel}</div>
                    </div>

                    {/* 盘口区：3列横向排列 */}
                    <div className="match-body-v2">
                      {/* 独赢(1/2/X) */}
                      <div className="market-column">
                        <div className="market-title">独赢(1/2/X)</div>
                        {renderMoneylineV2(event)}
                      </div>

                      {/* 让球(1/2) */}
                      <div className="market-column">
                        <div className="market-title">让球(1/2)</div>
                        {renderHandicapV2(event)}
                      </div>

                      {/* 大小(O/U) */}
                      <div className="market-column">
                        <div className="market-title">大小(O/U)</div>
                        {renderOverUnderV2(event)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default OddsApiMatchesPage;

