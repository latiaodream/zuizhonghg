import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tabs,
  Table,
  Space,
  Button,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Typography,
  Row,
  Col,
  Upload,
} from 'antd';
import { PlusOutlined, ReloadOutlined, UploadOutlined, DownloadOutlined, ImportOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { aliasApi } from '../services/api';
import type { AliasRecord } from '../types';

const { TabPane } = Tabs;
const { Title, Paragraph } = Typography;

const sanitizeAliases = (values?: string[]): string[] => {
  if (!Array.isArray(values)) return [];
  const set = new Set<string>();
  values.forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  });
  return Array.from(set);
};

const AliasManagerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'leagues' | 'teams'>('leagues');
  const [records, setRecords] = useState<AliasRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'unmatched'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AliasRecord | null>(null);
  const [form] = Form.useForm();
  const [refreshFlag, setRefreshFlag] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = search.trim() ? { search: search.trim() } : undefined;
      const response = activeTab === 'leagues'
        ? await aliasApi.listLeagues(params)
        : await aliasApi.listTeams(params);
      if (response.success) {
        setRecords(response.data || []);
      } else {
        message.error(response.error || '获取数据失败');
      }
    } catch (error: any) {
      console.error('加载别名数据失败:', error);
      message.error('加载别名数据失败');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, refreshFlag]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 筛选数据
  const filteredRecords = useMemo(() => {
    if (filterType === 'unmatched') {
      return records.filter(r => !r.name_crown_zh_cn || r.name_crown_zh_cn.trim() === '');
    }
    return records;
  }, [records, filterType]);

  const openModal = (record?: AliasRecord) => {
    if (record) {
      setEditingRecord(record);
      form.setFieldsValue({
        canonical_key: record.canonical_key,
        name_en: record.name_en,
        name_zh_cn: record.name_zh_cn,
        name_zh_tw: record.name_zh_tw,
        name_crown_zh_cn: record.name_crown_zh_cn,
        aliases: record.aliases,
      });
    } else {
      setEditingRecord(null);
      form.resetFields();
    }
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingRecord(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        canonical_key: values.canonical_key?.trim() || undefined,
        name_en: values.name_en?.trim() || undefined,
        name_zh_cn: values.name_zh_cn?.trim() || undefined,
        name_zh_tw: values.name_zh_tw?.trim() || undefined,
        name_crown_zh_cn: values.name_crown_zh_cn?.trim() || undefined,
        aliases: sanitizeAliases(values.aliases),
      };

      if (!payload.name_en && !payload.name_zh_cn && !payload.name_zh_tw && !payload.name_crown_zh_cn) {
        message.warning('至少填写一个名称字段');
        return;
      }

      if (editingRecord) {
        const response = activeTab === 'leagues'
          ? await aliasApi.updateLeague(editingRecord.id, payload)
          : await aliasApi.updateTeam(editingRecord.id, payload);
        if (response.success) {
          message.success('更新成功');
          setRefreshFlag((flag) => flag + 1);
          closeModal();
        } else {
          message.error(response.error || '更新失败');
        }
      } else {
        const response = activeTab === 'leagues'
          ? await aliasApi.createLeague(payload)
          : await aliasApi.createTeam(payload);
        if (response.success) {
          message.success('创建成功');
          setRefreshFlag((flag) => flag + 1);
          closeModal();
        } else {
          message.error(response.error || '创建失败');
        }
      }
    } catch (error: any) {
      if (error?.errorFields) return; // form validation error
      console.error('保存别名失败:', error);
      message.error(error?.message || '保存别名失败');
    }
  };

  const handleDelete = async (record: AliasRecord) => {
    try {
      const response = activeTab === 'leagues'
        ? await aliasApi.deleteLeague(record.id)
        : await aliasApi.deleteTeam(record.id);
      if (response.success) {
        message.success('已删除');
        setRefreshFlag((flag) => flag + 1);
      } else {
        message.error(response.error || '删除失败');
      }
    } catch (error: any) {
      console.error('删除别名失败:', error);
      message.error('删除别名失败');
    }
  };

  // 处理文件上传
  const handleUpload: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options;

    setUploading(true);
    try {
      const response = activeTab === 'leagues'
        ? await aliasApi.importLeagues(file as File)
        : await aliasApi.importTeams(file as File);

      if (response.success && response.data) {
        message.success(
          `${response.message || '导入成功'}`,
          5
        );
        Modal.info({
          title: '导入结果',
          content: (
            <div>
              <p>总行数: {response.data.total}</p>
              <p>更新成功: {response.data.updated}</p>
              <p>跳过: {response.data.skipped}</p>
              <p>未找到: {response.data.notFound}</p>
            </div>
          ),
        });
        setRefreshFlag((flag) => flag + 1);
        onSuccess?.(response);
      } else {
        message.error(response.error || '导入失败');
        onError?.(new Error(response.error || '导入失败'));
      }
    } catch (error: any) {
      console.error('上传文件失败:', error);
      message.error(error.message || '上传文件失败');
      onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  // 下载样本文件
  const handleDownloadSample = () => {
    const sampleData = activeTab === 'leagues'
      ? [
          ['AFC Champions League 2', '亚冠联赛2'],
          ['Argentina Cup', '阿根廷杯'],
          ['Australia A-League', '澳大利亚甲级联赛'],
        ]
      : [
          ['AC Milan', 'AC米兰'],
          ['Manchester United', '曼联'],
          ['Real Madrid', '皇家马德里'],
        ];

    // 创建 CSV 内容
    const csvContent = sampleData.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `${activeTab === 'leagues' ? 'leagues' : 'teams'}-sample.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    message.success('样本文件已下载');
  };

  // 导出未翻译的记录
  const handleExportUntranslated = async () => {
    try {
      setLoading(true);
      const blob = activeTab === 'leagues'
        ? await aliasApi.exportUntranslatedLeagues()
        : await aliasApi.exportUntranslatedTeams();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeTab === 'leagues' ? 'leagues' : 'teams'}-untranslated-${Date.now()}.xlsx`;
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      message.success('未翻译记录已导出');
    } catch (error: any) {
      console.error('导出未翻译记录失败:', error);
      if (error.response?.status === 404) {
        message.info('没有未翻译的记录');
      } else {
        message.error('导出失败');
      }
    } finally {
      setLoading(false);
    }
  };

  // 从皇冠赛事导入
  const handleImportFromCrown = async () => {
    Modal.confirm({
      title: '从皇冠赛事导入',
      content: '将从 crown_matches 表中提取所有联赛和球队名称，并添加到别名表中（已存在的会跳过）。确认继续？',
      onOk: async () => {
        setImporting(true);
        try {
          const response = await aliasApi.importFromCrown();
          if (response.success && response.data) {
            Modal.success({
              title: '导入成功',
              content: (
                <div>
                  <p><strong>联赛：</strong></p>
                  <p>总数: {response.data.leagues.total}</p>
                  <p>新增: {response.data.leagues.inserted}</p>
                  <p>跳过: {response.data.leagues.skipped}</p>
                  <br />
                  <p><strong>球队：</strong></p>
                  <p>总数: {response.data.teams.total}</p>
                  <p>新增: {response.data.teams.inserted}</p>
                  <p>跳过: {response.data.teams.skipped}</p>
                </div>
              ),
            });
            setRefreshFlag((flag) => flag + 1);
          } else {
            message.error(response.error || '导入失败');
          }
        } catch (error: any) {
          console.error('从皇冠赛事导入失败:', error);
          message.error(error.message || '导入失败');
        } finally {
          setImporting(false);
        }
      },
    });
  };

  // 从 iSports API 导入
  const handleImportFromISports = async () => {
    Modal.confirm({
      title: '从 iSports API 导入',
      content: '将从 iSports API 获取今天的赛事数据（仅有皇冠赔率的赛事），提取所有联赛和球队名称，并添加到别名表中。确认继续？',
      onOk: async () => {
        setImporting(true);
        try {
          const response = await aliasApi.importFromISports();
          if (response.success && response.data) {
            Modal.success({
              title: '导入成功',
              content: (
                <div>
                  <p><strong>联赛：</strong></p>
                  <p>总数: {response.data.leagues.total}</p>
                  <p>新增: {response.data.leagues.inserted}</p>
                  <p>更新: {response.data.leagues.updated}</p>
                  <p>跳过: {response.data.leagues.skipped}</p>
                  <br />
                  <p><strong>球队：</strong></p>
                  <p>总数: {response.data.teams.total}</p>
                  <p>新增: {response.data.teams.inserted}</p>
                  <p>更新: {response.data.teams.updated}</p>
                  <p>跳过: {response.data.teams.skipped}</p>
                </div>
              ),
            });
            setRefreshFlag((flag) => flag + 1);
          } else {
            message.error(response.error || '导入失败');
          }
        } catch (error: any) {
          console.error('从 iSports API 导入失败:', error);
          message.error(error.message || '导入失败');
        } finally {
          setImporting(false);
        }
      },
    });
  };

  const columns: ColumnsType<AliasRecord> = useMemo(() => [
    {
      title: 'Canonical Key',
      dataIndex: 'canonical_key',
      ellipsis: true,
      width: 220,
    },
    {
      title: 'iSports 简体',
      dataIndex: 'name_zh_cn',
      render: (text: string) => text || '-'
    },
    {
      title: 'iSports 繁体',
      dataIndex: 'name_zh_tw',
      render: (text: string) => text || '-'
    },
    {
      title: 'iSports 英文',
      dataIndex: 'name_en',
      render: (text: string) => text || '-'
    },
    {
      title: '皇冠简体',
      dataIndex: 'name_crown_zh_cn',
      render: (text: string) => text ? <Tag color="gold">{text}</Tag> : '-'
    },
    {
      title: '别名',
      dataIndex: 'aliases',
      render: (aliases: string[]) => (
        <Space size={[8, 8]} wrap>
          {(aliases || []).length > 0 ? aliases.map((alias) => (
            <Tag key={alias}>{alias}</Tag>
          )) : <span style={{ color: '#999' }}>无</span>}
        </Space>
      )
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 180,
      render: (value: string) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'
    },
    {
      title: '操作',
      fixed: 'right',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button size="small" type="link" onClick={() => openModal(record)}>编辑</Button>
          <Popconfirm
            title={`确认删除${activeTab === 'leagues' ? '联赛' : '球队'}别名？`}
            onConfirm={() => handleDelete(record)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ], [activeTab]);

  return (
    <div>
      <Title level={3}>名称映射管理</Title>
      <Paragraph type="secondary">
        为确保皇冠与 iSports 赛事、球队名称能够准确匹配，请维护好以下映射。支持按简体、繁体或英文名称搜索。
      </Paragraph>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as 'leagues' | 'teams');
          setSearch('');
        }}
      >
        <TabPane tab="联赛映射" key="leagues" />
        <TabPane tab="球队映射" key="teams" />
      </Tabs>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={8}>
          <Input.Search
            allowClear
            placeholder={`搜索${activeTab === 'leagues' ? '联赛' : '球队'}名称 / 别名`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={() => setRefreshFlag((flag) => flag + 1)}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Select
            style={{ width: '100%' }}
            value={filterType}
            onChange={(value) => setFilterType(value)}
            options={[
              { label: '全部', value: 'all' },
              { label: '仅显示未匹配皇冠简体', value: 'unmatched' },
            ]}
          />
        </Col>
        <Col flex="auto" />
        <Col>
          <Space wrap>
            <Button
              icon={<ImportOutlined />}
              onClick={handleImportFromCrown}
              loading={importing}
            >
              从皇冠赛事导入
            </Button>
            <Button
              icon={<ImportOutlined />}
              onClick={handleImportFromISports}
              loading={importing}
            >
              从iSports导入
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownloadSample}
            >
              下载样本
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportUntranslated}
              loading={loading}
            >
              导出未翻译
            </Button>
            <Upload
              accept=".xlsx,.xls"
              showUploadList={false}
              customRequest={handleUpload}
              disabled={uploading}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploading}
              >
                导入翻译
              </Button>
            </Upload>
            <Button icon={<ReloadOutlined />} onClick={() => setRefreshFlag((flag) => flag + 1)}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
              新增{activeTab === 'leagues' ? '联赛' : '球队'}
            </Button>
          </Space>
        </Col>
      </Row>

      <Table<AliasRecord>
        rowKey="id"
        loading={loading}
        dataSource={filteredRecords}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{
          pageSize: 50,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200', '500'],
          showTotal: (total) => `共 ${total} 条记录`
        }}
        footer={() => {
          const totalCount = records.length;
          const hasCrownCount = records.filter(r => r.name_crown_zh_cn).length;
          const matchRate = totalCount > 0 ? ((hasCrownCount / totalCount) * 100).toFixed(1) : '0.0';

          return (
            <div style={{ textAlign: 'center', color: '#666' }}>
              {filterType === 'unmatched' ? (
                <>
                  显示 <strong>{filteredRecords.length}</strong> 条未匹配记录
                  {' | '}
                  总记录: <strong>{totalCount}</strong>
                  {' | '}
                  匹配率: <strong style={{ color: hasCrownCount >= totalCount * 0.8 ? '#52c41a' : '#faad14' }}>{matchRate}%</strong>
                </>
              ) : (
                <>
                  共 <strong>{totalCount}</strong> 条{activeTab === 'leagues' ? '联赛' : '球队'}记录
                  {totalCount > 0 && (
                    <>
                      {' | '}
                      有繁体: <strong>{records.filter(r => r.name_zh_tw).length}</strong>
                      {' | '}
                      有英文: <strong>{records.filter(r => r.name_en).length}</strong>
                      {' | '}
                      有皇冠简体: <strong style={{ color: '#faad14' }}>{hasCrownCount}</strong>
                      {' | '}
                      匹配率: <strong style={{ color: hasCrownCount >= totalCount * 0.8 ? '#52c41a' : '#faad14' }}>{matchRate}%</strong>
                    </>
                  )}
                </>
              )}
            </div>
          );
        }}
      />

      <Modal
        open={modalVisible}
        title={`${editingRecord ? '编辑' : '新增'}${activeTab === 'leagues' ? '联赛' : '球队'}别名`}
        onCancel={closeModal}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form layout="vertical" form={form} preserve={false}>
          <Form.Item label="Canonical Key" name="canonical_key">
            <Input placeholder="可留空，系统会自动生成" allowClear />
          </Form.Item>
          <Form.Item label="iSports 简体" name="name_zh_cn">
            <Input placeholder="例：英格兰超级联赛" allowClear />
          </Form.Item>
          <Form.Item label="iSports 繁体" name="name_zh_tw">
            <Input placeholder="例：英格蘭超級聯賽" allowClear />
          </Form.Item>
          <Form.Item label="皇冠信用盘简体" name="name_crown_zh_cn">
            <Input placeholder="例：英超" allowClear />
          </Form.Item>
          <Form.Item label="iSports 英文" name="name_en">
            <Input placeholder="例：English Premier League" allowClear />
          </Form.Item>
          <Form.Item label="别名" name="aliases">
            <Select
              mode="tags"
              tokenSeparators={[',', ';', ' ', '\n']}
              placeholder="输入别名后回车确认"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AliasManagerPage;
