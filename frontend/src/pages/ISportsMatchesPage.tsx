import React, { useState, useEffect } from 'react';
import { Table, Card, DatePicker, Space, message, Tag, Input, Button } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { isportsMatchApi } from '../services/api';
import dayjs, { Dayjs } from 'dayjs';

const ISportsMatchesPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [searchLeague, setSearchLeague] = useState<string>('');
  const [searchHome, setSearchHome] = useState<string>('');
  const [searchAway, setSearchAway] = useState<string>('');

  // 加载赛事数据
  const loadMatches = async () => {
    try {
      setLoading(true);
      const date = selectedDate.format('YYYY-MM-DD');
      const response = await isportsMatchApi.getMatches({ date });

      if (response.success && response.data) {
        setMatches(response.data.matches);
        setFilteredMatches(response.data.matches);
      } else {
        message.error(response.message || '加载失败');
      }
    } catch (error: any) {
      console.error('加载 iSports 赛事失败:', error);
      message.error(error.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 搜索过滤
  const handleSearch = () => {
    let filtered = [...matches];

    if (searchLeague) {
      filtered = filtered.filter(m =>
        m.leagueNameZhCn?.toLowerCase().includes(searchLeague.toLowerCase()) ||
        m.leagueName?.toLowerCase().includes(searchLeague.toLowerCase())
      );
    }

    if (searchHome) {
      filtered = filtered.filter(m =>
        m.homeNameZhCn?.toLowerCase().includes(searchHome.toLowerCase()) ||
        m.homeName?.toLowerCase().includes(searchHome.toLowerCase())
      );
    }

    if (searchAway) {
      filtered = filtered.filter(m =>
        m.awayNameZhCn?.toLowerCase().includes(searchAway.toLowerCase()) ||
        m.awayName?.toLowerCase().includes(searchAway.toLowerCase())
      );
    }

    setFilteredMatches(filtered);
  };

  // 重置搜索
  const handleResetSearch = () => {
    setSearchLeague('');
    setSearchHome('');
    setSearchAway('');
    setFilteredMatches(matches);
  };

  // 日期变化时重新加载
  useEffect(() => {
    loadMatches();
  }, [selectedDate]);

  // 监听搜索条件变化
  useEffect(() => {
    handleSearch();
  }, [searchLeague, searchHome, searchAway, matches]);

  // 表格列定义
  const columns = [
    {
      title: '比赛ID',
      dataIndex: 'matchId',
      key: 'matchId',
      width: 120,
    },
    {
      title: '联赛',
      dataIndex: 'leagueNameZhCn',
      key: 'leagueNameZhCn',
      width: 200,
      render: (_: any, record: any) => (
        <div>
          <div>{record.leagueNameZhCn}</div>
          {!record.leagueMapped && (
            <div style={{ fontSize: '12px', color: '#999' }}>
              原名: {record.leagueName}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '主队',
      dataIndex: 'homeNameZhCn',
      key: 'homeNameZhCn',
      width: 150,
      render: (_: any, record: any) => (
        <div>
          <div>{record.homeNameZhCn}</div>
          {!record.homeMapped && (
            <div style={{ fontSize: '12px', color: '#999' }}>
              原名: {record.homeName}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '客队',
      dataIndex: 'awayNameZhCn',
      key: 'awayNameZhCn',
      width: 150,
      render: (_: any, record: any) => (
        <div>
          <div>{record.awayNameZhCn}</div>
          {!record.awayMapped && (
            <div style={{ fontSize: '12px', color: '#999' }}>
              原名: {record.awayName}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '比赛时间',
      dataIndex: 'matchTime',
      key: 'matchTime',
      width: 180,
      render: (time: number) => {
        return dayjs(time * 1000).format('YYYY-MM-DD HH:mm:ss');
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: number) => {
        const statusMap: Record<number, string> = {
          0: '未开始',
          1: '进行中',
          2: '已结束',
          3: '延期',
          4: '取消',
          5: '中断',
        };
        return statusMap[status] || `状态${status}`;
      },
    },
    {
      title: '比分',
      key: 'score',
      width: 100,
      render: (_: any, record: any) => {
        if (record.status === 0) {
          return '-';
        }
        return `${record.homeScore || 0} : ${record.awayScore || 0}`;
      },
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <h1>iSports 足球赛事记录</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        iSports 足球赛事数据（仅显示有皇冠赔率的赛事，已映射为简体中文）
      </p>

      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
          <Space wrap>
            <DatePicker
              value={selectedDate}
              onChange={(date) => date && setSelectedDate(date)}
              format="YYYY-MM-DD"
              placeholder="选择日期"
            />
            <span style={{ color: '#666' }}>
              共 {matches.length} 场比赛
            </span>
          </Space>

          {/* 搜索条件 */}
          <Space wrap>
            <Input
              placeholder="搜索联赛"
              prefix={<SearchOutlined />}
              value={searchLeague}
              onChange={(e) => setSearchLeague(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Input
              placeholder="搜索主队"
              prefix={<SearchOutlined />}
              value={searchHome}
              onChange={(e) => setSearchHome(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Input
              placeholder="搜索客队"
              prefix={<SearchOutlined />}
              value={searchAway}
              onChange={(e) => setSearchAway(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Button onClick={handleResetSearch}>重置</Button>
            <span style={{ color: '#666' }}>
              显示 {filteredMatches.length} / {matches.length} 场比赛
            </span>
          </Space>
        </Space>

        <Table
          columns={columns}
          dataSource={filteredMatches}
          rowKey="matchId"
          loading={loading}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 场比赛`,
          }}
          locale={{
            emptyText: (
              <div style={{ padding: '40px 0' }}>
                <p>{selectedDate.format('YYYY-MM-DD')} 暂无赛事数据</p>
              </div>
            ),
          }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  );
};

export default ISportsMatchesPage;

