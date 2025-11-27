import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  message,
  Typography,
  Row,
  Col,
  Select,
  Input,
  Divider,
  Empty,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type { CrownAccount, Group } from '../types';
import { accountApi, groupApi, crownApi } from '../services/api';
import { generateAccountUsername, generateAccountPassword } from '../utils/credentials';
import AccountFormModal from '../components/Accounts/AccountFormModal';
import AccountDetailModal from '../components/Accounts/AccountDetailModal';
import AccountCard from '../components/Accounts/AccountCard';
import AccountInitializeModal from '../components/Accounts/AccountInitializeModal';
import type { AxiosError } from 'axios';

const { Title, Text } = Typography;
const { Search } = Input;

const AccountsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<CrownAccount[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<number | undefined>();
  const [searchText, setSearchText] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 模态框状态
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [initializeModalVisible, setInitializeModalVisible] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CrownAccount | null>(null);
  const [viewingAccount, setViewingAccount] = useState<CrownAccount | null>(null);
  const [initializingAccount, setInitializingAccount] = useState<CrownAccount | null>(null);
  const [initCredentials, setInitCredentials] = useState({ username: '', password: '' });

  useEffect(() => {
    loadGroups();
    loadAccounts();
  }, [selectedGroup]);

  const loadGroups = async () => {
    try {
      const response = await groupApi.getGroups();
      if (response.success && response.data) {
        setGroups(response.data);
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
    }
  };

  const loadAccounts = async () => {
    try {
      setLoading(true);

      // 只获取账号列表，在线状态使用数据库中的 is_online 字段
      const accountResponse = await accountApi.getAccounts(selectedGroup);

      if (accountResponse.success && accountResponse.data) {
        setAccounts(accountResponse.data);
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
      message.error('加载账号列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = () => {
    setEditingAccount(null);
    setFormModalVisible(true);
  };

  const handleEditAccount = (account: CrownAccount) => {
    setEditingAccount(account);
    setFormModalVisible(true);
  };

  const handleViewAccount = (account: CrownAccount) => {
    setViewingAccount(account);
    setDetailModalVisible(true);
  };



  const handleDeleteAccount = async (id: number) => {
    try {
      const response = await accountApi.deleteAccount(id);
      if (response.success) {
        message.success('账号删除成功');
        loadAccounts();
      }
    } catch (error) {
      console.error('Failed to delete account:', error);
      message.error('删除账号失败');
    }
  };

  const handleToggleAccountStatus = async (account: CrownAccount) => {
    try {
      const response = await accountApi.updateAccount(account.id, {
        is_enabled: !account.is_enabled,
      });
      if (response.success) {
        message.success(`账号已${!account.is_enabled ? '启用' : '禁用'}`);
        loadAccounts();
      }
    } catch (error) {
      console.error('Failed to update account status:', error);
      message.error('更新账号状态失败');
    }
  };



  const handleBatchStatusUpdate = async (enabled: boolean) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要操作的账号');
      return;
    }

    try {
      const response = await accountApi.batchUpdateStatus(
        selectedRowKeys as number[],
        enabled
      );
      if (response.success) {
        message.success(`批量${enabled ? '启用' : '禁用'}成功`);
        setSelectedRowKeys([]);
        loadAccounts();
      }
    } catch (error) {
      console.error('Failed to batch update status:', error);
      message.error('批量操作失败');
    }
  };

  const handleBatchLogin = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要登录的账号');
      return;
    }

    const batchKey = 'batch-login';
    try {
      message.loading({ content: `正在批量登录 ${selectedRowKeys.length} 个账号...`, key: batchKey, duration: 0 });
      const response = await crownApi.batchLogin(selectedRowKeys as number[]);

      if (response.success) {
        const data = response.data as { successCount?: number; totalCount?: number };
        const successMsg = data?.successCount !== undefined
          ? `批量登录完成，成功 ${data.successCount}/${data.totalCount} 个账号`
          : response.message || '批量登录成功';
        message.success({ content: successMsg, key: batchKey, duration: 3 });
        setSelectedRowKeys([]);
        loadAccounts();
      } else {
        message.error({ content: `批量登录失败: ${response.error || '未知错误'}`, key: batchKey, duration: 3 });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '网络错误';
      message.error({ content: `批量登录失败: ${errorMsg}`, key: batchKey, duration: 3 });
      console.error('Failed to batch login:', error);
    }
  };

  const handleBatchLogout = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要登出的账号');
      return;
    }

    try {
      const response = await crownApi.batchLogout(selectedRowKeys as number[]);
      if (response.success) {
        message.success(response.message);
        setSelectedRowKeys([]);
        loadAccounts();
      } else {
        message.error(response.error || '批量登出失败');
      }
    } catch (error) {
      console.error('Failed to batch logout:', error);
      message.error('批量登出失败');
    }
  };

  // 单个账号登录（纯 API 方式）
  const handleLoginAccount = async (account: CrownAccount) => {
    const key = `login-${account.id}`;
    try {
      message.loading({ content: `正在登录账号 ${account.username}...`, key, duration: 0 });
      const response = await crownApi.loginAccount(account.id);
      if (response.success) {
        message.success({ content: `账号 ${account.username} 登录成功`, key, duration: 2 });
        await loadAccounts();
      } else {
        // 🔥 检查是否需要初始化
        const data = response.data as { needsInitialization?: boolean } | undefined;
        if (data?.needsInitialization) {
          message.warning({ content: '账号需要初始化，正在打开初始化窗口...', key, duration: 2 });
          handleOpenInitialize(account);
        } else {
          message.error({ content: response.error || '登录失败', key, duration: 3 });
        }
      }
    } catch (error: any) {
      // 🔥 检查是否需要初始化
      const respData = error.response?.data;
      if (respData?.data?.needsInitialization) {
        message.warning({ content: '账号需要初始化，正在打开初始化窗口...', key: key, duration: 2 });
        handleOpenInitialize(account);
      } else {
        message.error({ content: respData?.error || '登录失败', key, duration: 3 });
      }
    }
  };

  // 打开初始化模态框
  const handleOpenInitialize = (account: CrownAccount) => {
    setInitializingAccount(account);
    setInitCredentials({
      username: generateAccountUsername(),
      password: generateAccountPassword(),
    });
    setInitializeModalVisible(true);
  };

  // 执行初始化
  const handleInitializeAccount = async (payload: { username: string; password: string }) => {
    if (!initializingAccount) return;

    const key = `init-${initializingAccount.id}`;
    try {
      message.loading({ content: `正在初始化账号 ${initializingAccount.username}...`, key, duration: 0 });
      const response = await crownApi.initializeAccountWithApi(initializingAccount.id, payload);
      if (response.success) {
        message.success({ content: `账号初始化成功！新账号: ${payload.username}`, key, duration: 3 });
        setInitializeModalVisible(false);
        setInitializingAccount(null);
        await loadAccounts();
      } else {
        message.error({ content: response.error || '初始化失败', key, duration: 3 });
      }
    } catch (error: any) {
      message.error({ content: error.response?.data?.error || '初始化失败', key, duration: 3 });
    }
  };

  // 重新生成凭证
  const handleRegenerateCredential = (field: 'username' | 'password') => {
    if (field === 'username') {
      setInitCredentials(prev => ({ ...prev, username: generateAccountUsername() }));
    } else {
      setInitCredentials(prev => ({ ...prev, password: generateAccountPassword() }));
    }
  };

  // 单个账号登出
  const handleLogoutAccount = async (account: CrownAccount) => {
    const key = `logout-${account.id}`;
    try {
      message.loading({ content: `正在登出账号 ${account.username}...`, key, duration: 0 });
      const response = await crownApi.logoutAccount(account.id);
      if (response.success) {
        message.success({ content: `账号 ${account.username} 已登出`, key, duration: 2 });
        await loadAccounts();
      } else {
        message.error({ content: response.error || '登出失败', key, duration: 3 });
      }
    } catch (error: any) {
      message.error({ content: error.response?.data?.error || '登出失败', key, duration: 3 });
    }
  };

  // 单个账号刷新余额
  const handleRefreshBalance = async (account: CrownAccount) => {
    const key = `refresh-${account.id}`;
    try {
      message.loading({ content: `正在刷新账号 ${account.username} 的余额...`, key, duration: 0 });
      const response = await crownApi.getAccountBalance(account.id);
      if (response.success) {
        message.success({ content: `账号 ${account.username} 余额刷新成功`, key, duration: 2 });
        await loadAccounts();
      } else {
        message.error({ content: response.error || '刷新余额失败', key, duration: 3 });
      }
    } catch (error: any) {
      message.error({ content: error.response?.data?.error || '刷新余额失败', key, duration: 3 });
    }
  };

  const normalizeHistoryPayload = (raw: any) => {
    let payload = raw;
    if (typeof payload === 'string') {
      const cleaned = payload.replace(/^\uFEFF/, '').trim();
      if (cleaned) {
        try {
          payload = JSON.parse(cleaned);
        } catch (error) {
          try {
            payload = JSON.parse(cleaned.replace(/'/g, '"'));
          } catch {
            return { payload: raw, wagers: [] as any[] };
          }
        }
      }
    }

    const wagers: any[] = [];
    const visited = new Set<any>();

    const isObjectCandidate = (value: any) =>
      value && typeof value === 'object' && !Array.isArray(value);

    const traverse = (value: any) => {
      if (!value || visited.has(value)) {
        return;
      }

      if (Array.isArray(value)) {
        visited.add(value);
        const objectCandidates = value.filter(isObjectCandidate);
        if (objectCandidates.length > 0) {
          wagers.push(...objectCandidates);
        }
        value.forEach(traverse);
        return;
      }

      if (isObjectCandidate(value)) {
        visited.add(value);
        Object.values(value).forEach(traverse);
      }
    };

    traverse(payload);

    return { payload, wagers };
  };

  // 查账 - 查询账号下注历史记录（最近7天）
  const handleCheckHistory = async (account: CrownAccount) => {
    const key = `check-history-${account.id}`;
    try {
      message.loading({ content: `正在获取账号 ${account.username} 的下注记录（最近7天）...`, key, duration: 0 });

      // 计算一周前的日期
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      // 格式化日期为 YYYY-MM-DD
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const response = await crownApi.getHistory(account.id, {
        gtype: 'ALL',
        isAll: 'N',
        startdate: formatDate(startDate),
        enddate: formatDate(endDate),
        filter: 'Y'
      });

      if (response.success) {
        const data = response.data;

        // 解析 XML 格式的历史记录
        const totalGold = data.total_gold || 0;
        const totalVgold = data.total_vgold || 0;
        const totalWinloss = data.total_winloss || 0;

        // 提取历史记录数组
        let historyList: any[] = [];
        if (data.history) {
          historyList = Array.isArray(data.history) ? data.history : [data.history];
          // 过滤掉没有数据的记录（gold 为 '-'）
          historyList = historyList.filter((h: any) => h.gold && h.gold !== '-');
        }

        message.success({ content: `成功获取账号 ${account.username} 的下注记录`, key, duration: 2 });

        // 显示查账结果
        Modal.info({
          title: `账号 ${account.username} 的下注记录（最近7天）`,
          width: 800,
          content: (
            <div>
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f0f2f5', borderRadius: '4px' }}>
                <div style={{ marginBottom: '8px' }}>
                  <Text strong>查询时间：</Text>
                  <Text>{formatDate(startDate)} 至 {formatDate(endDate)}</Text>
                </div>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <Text strong>总投注：</Text>
                    <Text style={{ color: '#1890ff', fontSize: '16px', marginLeft: '8px' }}>{totalGold}</Text>
                  </div>
                  <div>
                    <Text strong>有效投注：</Text>
                    <Text style={{ color: '#52c41a', fontSize: '16px', marginLeft: '8px' }}>{totalVgold}</Text>
                  </div>
                  <div>
                    <Text strong>输赢：</Text>
                    <Text style={{
                      color: parseFloat(totalWinloss) >= 0 ? '#52c41a' : '#ff4d4f',
                      fontSize: '16px',
                      marginLeft: '8px',
                      fontWeight: 'bold'
                    }}>
                      {parseFloat(totalWinloss) >= 0 ? '+' : ''}{totalWinloss}
                    </Text>
                  </div>
                </div>
              </div>
              {historyList.length > 0 ? (
                <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                  {historyList.map((history: any, index: number) => (
                    <div key={index} style={{
                      padding: '12px',
                      border: '1px solid #d9d9d9',
                      borderRadius: '4px',
                      marginBottom: '8px',
                      backgroundColor: '#fff',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                          {history.date_name || history.date}
                        </div>
                        <div style={{ fontSize: '12px', color: '#8c8c8c' }}>
                          {history.date}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ marginBottom: '4px' }}>
                          <Text type="secondary">投注：</Text>
                          <Text strong>{history.gold}</Text>
                          <Divider type="vertical" />
                          <Text type="secondary">有效：</Text>
                          <Text strong>{history.vgold}</Text>
                        </div>
                        <div>
                          <Text type="secondary">输赢：</Text>
                          <Text strong style={{
                            color: parseFloat(history.winloss) >= 0 ? '#52c41a' : '#ff4d4f',
                            fontSize: '14px'
                          }}>
                            {parseFloat(history.winloss) >= 0 ? '+' : ''}{history.winloss}
                          </Text>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  description="最近7天暂无下注记录"
                  style={{ padding: '40px 0' }}
                />
              )}
            </div>
          ),
        });
      } else {
        message.error({ content: response.error || '获取下注记录失败', key, duration: 3 });
      }
    } catch (error: any) {
      message.error({ content: error.response?.data?.error || '获取下注记录失败', key, duration: 3 });
    }
  };

  const handleRefreshAllBalances = async () => {
    const onlineAccounts = accounts.filter(account => account.is_online);

    if (onlineAccounts.length === 0) {
      message.warning('没有在线的账号可以刷新余额');
      return;
    }

    const batchKey = 'refresh-all-balances';
    message.loading({
      content: `正在刷新 ${onlineAccounts.length} 个在线账号的余额...`,
      key: batchKey,
      duration: 0
    });

    let successCount = 0;
    let partialCount = 0; // 只获取到额度的账号
    let failCount = 0;
    const failedAccounts: string[] = [];

    try {
      // 并发刷新所有在线账号的余额
      const results = await Promise.allSettled(
        onlineAccounts.map(account => crownApi.getAccountBalance(account.id))
      );

      results.forEach((result, index) => {
        const account = onlineAccounts[index];
        if (result.status === 'fulfilled') {
          const response = result.value;
          const balanceData = (response as any)?.data || {};

          // 参考登录后的余额同步逻辑
          if (response.success) {
            successCount++;
            if (balanceData.balance_source) {
              console.debug(`账号 ${account.username} 余额来源: ${balanceData.balance_source}`);
            }
          } else {
            // 即使 success 为 false，如果有 credit 数据也算部分成功
            if (balanceData.credit) {
              partialCount++;
              console.warn(`账号 ${account.username} 仅取得额度: ${balanceData.credit}`);
            } else {
              failCount++;
              failedAccounts.push(account.username);
              const reason = response.error || response.message || '未知错误';
              console.warn(`刷新账号 ${account.username} 余额失败: ${reason}`);
            }
          }
        } else {
          failCount++;
          failedAccounts.push(account.username);
          console.warn(`刷新账号 ${account.username} 余额失败:`, result.reason);
        }
      });

      // 刷新完成后重新加载账号列表
      await loadAccounts();

      // 根据结果显示不同的提示
      if (failCount === 0 && partialCount === 0) {
        message.success({
          content: `余额刷新完成！成功 ${successCount} 个账号`,
          key: batchKey,
          duration: 3
        });
      } else if (failCount === 0 && partialCount > 0) {
        message.warning({
          content: `余额刷新完成！成功 ${successCount} 个，${partialCount} 个仅获取到额度`,
          key: batchKey,
          duration: 4
        });
      } else {
        const msg = `余额刷新完成！成功 ${successCount} 个${partialCount > 0 ? `，${partialCount} 个仅获取到额度` : ''}，失败 ${failCount} 个`;
        message.warning({
          content: msg,
          key: batchKey,
          duration: 4
        });
      }
    } catch (error) {
      console.error('Failed to refresh balances:', error);
      message.error({
        content: '批量刷新余额失败',
        key: batchKey,
        duration: 3
      });
    }
  };

  const handleFormSubmit = async () => {
    setFormModalVisible(false);
    loadAccounts();
    loadGroups();
  };

  const handleGroupCreated = (group: Group) => {
    setGroups(prev => {
      if (prev.some(existing => existing.id === group.id)) {
        return prev;
      }
      return [...prev, group];
    });
  };

  // 过滤账号数据
  const filteredAccounts = accounts.filter(account =>
    account.username.toLowerCase().includes(searchText.toLowerCase()) ||
    account.display_name.toLowerCase().includes(searchText.toLowerCase()) ||
    account.group_name?.toLowerCase().includes(searchText.toLowerCase())
  );


  return (
    <div style={{ padding: isMobile ? 0 : '4px 8px' }}>
      <Card style={isMobile ? { marginBottom: 1, borderRadius: 0 } : { marginBottom: 12 }}>
        <Row gutter={isMobile ? [0, 8] : [16, 16]} align="middle">
          <Col xs={24} sm={8} md={6}>
            <Select
              placeholder="选择分组"
              style={{ width: '100%' }}
              allowClear
              value={selectedGroup}
              onChange={setSelectedGroup}
              size={isMobile ? 'small' : 'middle'}
              options={[
                { label: '全部分组', value: undefined },
                ...groups.map(group => ({
                  label: group.name,
                  value: group.id,
                })),
              ]}
            />
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Search
              placeholder="搜索账号"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: '100%' }}
              size={isMobile ? 'small' : 'middle'}
            />
          </Col>
          <Col xs={24} sm={8} md={12}>
            <Space wrap size={isMobile ? 4 : 8}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateAccount}
                size={isMobile ? 'small' : 'middle'}
              >
                {isMobile ? '新增' : '新增账号'}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRefreshAllBalances}
                loading={loading}
                size={isMobile ? 'small' : 'middle'}
              >
                {isMobile ? '刷新' : '刷新余额'}
              </Button>
              {selectedRowKeys.length > 0 && (
                <>
                  {!isMobile && <Divider type="vertical" />}
                  <Button
                    type="primary"
                    ghost
                    onClick={() => handleBatchStatusUpdate(true)}
                    size={isMobile ? 'small' : 'middle'}
                  >
                    {isMobile ? '启用' : '批量启用'}
                  </Button>
                  <Button
                    onClick={() => handleBatchStatusUpdate(false)}
                    size={isMobile ? 'small' : 'middle'}
                  >
                    {isMobile ? '禁用' : '批量禁用'}
                  </Button>
                  {!isMobile && <Divider type="vertical" />}
                  <Button
                    type="primary"
                    ghost
                    onClick={handleBatchLogin}
                    size={isMobile ? 'small' : 'middle'}
                  >
                    {isMobile ? '登录' : '批量登录'}
                  </Button>
                  <Button
                    onClick={handleBatchLogout}
                    size={isMobile ? 'small' : 'middle'}
                  >
                    {isMobile ? '登出' : '批量登出'}
                  </Button>
                </>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      <Card
        title={
          <Space size={isMobile ? 4 : 8}>
            <AppstoreOutlined />
            <span style={{ fontSize: isMobile ? '14px' : '16px' }}>账号卡片</span>
            <span style={{ fontSize: isMobile ? '12px' : '14px', fontWeight: 'normal', color: '#666' }}>
              共 {filteredAccounts.length} 个
            </span>
          </Space>
        }
        loading={loading}
        style={isMobile ? { margin: 0, borderRadius: 0 } : {}}
        bodyStyle={isMobile ? { padding: 0 } : {}}
      >
        {filteredAccounts.length > 0 ? (
          <div className="account-card-grid">
            {filteredAccounts.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                onEdit={handleEditAccount}
                onDelete={handleDeleteAccount}
                onToggleStatus={handleToggleAccountStatus}
                onLogin={handleLoginAccount}
                onLogout={handleLogoutAccount}
                onRefresh={handleRefreshBalance}
                onCheckHistory={handleCheckHistory}
                onInitialize={handleOpenInitialize}
              />
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无账号数据"
            style={{ padding: '60px 0' }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateAccount}>
              立即创建
            </Button>
          </Empty>
        )}
      </Card>

      {/* 账号表单模态框 */}
      <AccountFormModal
        visible={formModalVisible}
        account={editingAccount}
        groups={groups}
        onCancel={() => setFormModalVisible(false)}
        onSubmit={handleFormSubmit}
        onGroupCreated={handleGroupCreated}
      />

      {/* 账号详情模态框 */}
      <AccountDetailModal
        visible={detailModalVisible}
        account={viewingAccount}
        onCancel={() => setDetailModalVisible(false)}
        onEdit={(account) => {
          setDetailModalVisible(false);
          handleEditAccount(account);
        }}
      />

      {/* 初始化账号模态框 */}
      <AccountInitializeModal
        open={initializeModalVisible}
        account={initializingAccount}
        onCancel={() => {
          setInitializeModalVisible(false);
          setInitializingAccount(null);
        }}
        onSubmit={handleInitializeAccount}
        credentials={initCredentials}
        onCredentialsChange={(values) => setInitCredentials(prev => ({ ...prev, ...values }))}
        onRegenerate={handleRegenerateCredential}
      />
    </div>
  );
};

export default AccountsPage;
