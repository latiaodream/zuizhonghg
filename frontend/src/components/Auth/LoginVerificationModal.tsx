import React, { useState } from 'react';
import { Modal, Form, Input, Button, message, Space, Typography, Alert } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { verificationApi } from '../../services/verification.api';

const { Text } = Typography;

interface LoginVerificationModalProps {
  visible: boolean;
  userId: number;
  email: string;
  username: string;
  password: string;
  onSuccess: (verificationCode: string) => void;
  onCancel: () => void;
}

const LoginVerificationModal: React.FC<LoginVerificationModalProps> = ({
  visible,
  userId,
  email,
  username,
  password,
  onSuccess,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 自动发送验证码（首次打开时）
  React.useEffect(() => {
    if (visible && countdown === 0) {
      handleSendCode();
    }
  }, [visible]);

  // 发送验证码
  const handleSendCode = async () => {
    try {
      setSendingCode(true);
      const response = await verificationApi.sendVerificationCode(
        userId,
        email,
        'login_verification'
      );

      if (response.success) {
        message.success('验证码已发送到您的邮箱');
        
        // 开发环境显示验证码
        if (response.data?.code) {
          message.info(`开发环境验证码：${response.data.code}`, 10);
        }

        // 开始倒计时
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        message.error(response.error || '发送验证码失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '发送验证码失败');
    } finally {
      setSendingCode(false);
    }
  };

  // 提交验证码
  const handleSubmit = async (values: any) => {
    onSuccess(values.verificationCode);
  };

  return (
    <Modal
      title="安全验证"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={450}
      maskClosable={false}
    >
      <Alert
        message="检测到非常用网络登录"
        description={`为了保障账号安全，我们已向 ${email} 发送了验证码，请查收。`}
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="verificationCode"
          label="验证码"
          rules={[
            { required: true, message: '请输入验证码' },
            { len: 6, message: '验证码为6位数字' },
          ]}
        >
          <Space.Compact style={{ width: '100%' }}>
            <Input
              prefix={<SafetyOutlined />}
              placeholder="请输入6位验证码"
              size="large"
              maxLength={6}
              autoFocus
            />
            <Button
              size="large"
              onClick={handleSendCode}
              loading={sendingCode}
              disabled={countdown > 0}
            >
              {countdown > 0 ? `${countdown}秒后重试` : '重新发送'}
            </Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            style={{ width: '100%' }}
          >
            验证并登录
          </Button>
        </Form.Item>
      </Form>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          验证成功后，此网络将被添加到信任列表
        </Text>
      </div>
    </Modal>
  );
};

export default LoginVerificationModal;

