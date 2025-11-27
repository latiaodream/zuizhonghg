import React, { useState } from 'react';
import { Modal, Form, Input, Button, message, Space, Typography } from 'antd';
import { MailOutlined, SafetyOutlined } from '@ant-design/icons';
import { verificationApi } from '../../services/verification.api';

const { Text } = Typography;

interface EmailBindingModalProps {
  visible: boolean;
  userId: number;
  defaultEmail: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const EmailBindingModal: React.FC<EmailBindingModalProps> = ({
  visible,
  userId,
  defaultEmail,
  onSuccess,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 发送验证码
  const handleSendCode = async () => {
    try {
      const email = form.getFieldValue('email') || defaultEmail;
      
      if (!email) {
        message.error('请输入邮箱地址');
        return;
      }

      setSendingCode(true);
      const response = await verificationApi.sendVerificationCode(
        userId,
        email,
        'email_binding'
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

  // 提交绑定
  const handleSubmit = async (values: any) => {
    try {
      setLoading(true);
      const response = await verificationApi.bindEmail(
        userId,
        values.email || defaultEmail,
        values.verificationCode
      );

      if (response.success) {
        message.success('邮箱绑定成功');
        form.resetFields();
        onSuccess();
      } else {
        message.error(response.error || '绑定失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '绑定失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="绑定邮箱"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={450}
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          为了保障账号安全，首次登录需要绑定邮箱。绑定后，在非常用网络登录时需要邮箱验证。
        </Text>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ email: defaultEmail }}
      >
        <Form.Item
          name="email"
          label="邮箱地址"
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input
            prefix={<MailOutlined />}
            placeholder="请输入邮箱地址"
            size="large"
            disabled={!!defaultEmail}
          />
        </Form.Item>

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
            />
            <Button
              size="large"
              onClick={handleSendCode}
              loading={sendingCode}
              disabled={countdown > 0}
            >
              {countdown > 0 ? `${countdown}秒后重试` : '发送验证码'}
            </Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            style={{ width: '100%' }}
          >
            确认绑定
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EmailBindingModal;

