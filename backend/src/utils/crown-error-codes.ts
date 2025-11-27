/**
 * 皇冠错误代码映射表
 * 根据皇冠系统返回的错误代码，提供中文说明
 */

export interface CrownErrorCode {
  code: string;
  message: string;
  category: 'network' | 'validation' | 'limit' | 'status' | 'balance' | 'odds' | 'other';
}

export const CROWN_ERROR_CODES: Record<string, CrownErrorCode> = {
  // 网络相关错误
  '0X001': {
    code: '0X001',
    message: '由于网络滞塞较慢，请重新再试。谢谢!',
    category: 'network',
  },
  '0X002': {
    code: '0X002',
    message: '由于网络滞塞较慢，请重新再试。谢谢!',
    category: 'network',
  },

  // 系统忙碌
  '0X003': {
    code: '0X003',
    message: '系统正在忙碌中，请稍后再试。',
    category: 'status',
  },
  '0X004': {
    code: '0X004',
    message: '系统正在忙碌中，请稍后再试。',
    category: 'status',
  },
  '0X005': {
    code: '0X005',
    message: '系统正在忙碌中，请稍后再试。',
    category: 'status',
  },
  '0X006': {
    code: '0X006',
    message: '系统暂停化中，请稍后。',
    category: 'status',
  },
  '0X007': {
    code: '0X007',
    message: '系统正在忙碌中，请稍后再试。',
    category: 'status',
  },
  '0X008': {
    code: '0X008',
    message: '系统正在忙碌中，请稍后再试。',
    category: 'status',
  },

  // 盘口相关
  '0X009': {
    code: '0X009',
    message: '此盘还不再开放投注，请从交易单中移除。',
    category: 'status',
  },
  '1X001': {
    code: '1X001',
    message: '此盘还自前不开放投注。',
    category: 'status',
  },
  '1X002': {
    code: '1X002',
    message: '已超过停止交易时间，无法进行交易。',
    category: 'status',
  },
  '1X003': {
    code: '1X003',
    message: '本场大已经至走地盘口，请至走地交易。',
    category: 'status',
  },
  '1X011': {
    code: '1X011',
    message: '此盘还不再开放投注，请从交易单中移除。',
    category: 'status',
  },

  // 金额相关
  '1X004': {
    code: '1X004',
    message: '最小投注金额为',
    category: 'limit',
  },
  '1X005': {
    code: '1X005',
    message: '让球数，赔率或比分已更新。',
    category: 'odds',
  },
  '1X006': {
    code: '1X006',
    message: '让球数，赔率或比分已更新。',
    category: 'odds',
  },
  '1X007': {
    code: '1X007',
    message: '输入此盘口的金额，无法进行交易!!',
    category: 'validation',
  },
  '1X008': {
    code: '1X008',
    message: '交易金额不可大于您不单场投注信用额度。请联络您的直属上线以解决这个问题。',
    category: 'limit',
  },
  '1X009': {
    code: '1X009',
    message: '暂时停止交易',
    category: 'status',
  },
  '1X010': {
    code: '1X010',
    message: '暂时停止交易',
    category: 'status',
  },
  '1X012': {
    code: '1X012',
    message: '您的总投注金额已超过您的额，请重新编辑投注金额。',
    category: 'limit',
  },
  '1X013': {
    code: '1X013',
    message: '赔率错误，请重新交易。',
    category: 'odds',
  },
  '1X014': {
    code: '1X014',
    message: '登入失败，请重新登录。',
    category: 'other',
  },
  '1X015': {
    code: '1X015',
    message: '让球数，赔率或比分已更新。',
    category: 'odds',
  },
  '1X016': {
    code: '1X016',
    message: '让球数，赔率或比分已更新。',
    category: 'odds',
  },
  '1X017': {
    code: '1X017',
    message: '已超过单场交过关主盘限额',
    category: 'limit',
  },
  '1X018': {
    code: '1X018',
    message: '最高投注额设限',
    category: 'limit',
  },
  '1X019': {
    code: '1X019',
    message: '同组合可赢金额不得超过人民币',
    category: 'limit',
  },
  '1X020': {
    code: '1X020',
    message: '单注最高可赢金额：人民币',
    category: 'limit',
  },
  '1X021': {
    code: '1X021',
    message: '让球盘重复',
    category: 'validation',
  },
  '1X022': {
    code: '1X022',
    message: '最小投注金额为',
    category: 'limit',
  },
  '1X023': {
    code: '1X023',
    message: '本场有不走主盘额需要',
    category: 'validation',
  },
  '1X024': {
    code: '1X024',
    message: '下注失败，请重新交易。',
    category: 'other',
  },
  '1X025': {
    code: '1X025',
    message: '转盘错误',
    category: 'other',
  },
};

/**
 * 根据错误代码获取错误信息
 * @param code 错误代码
 * @returns 错误信息对象
 */
export function getCrownErrorMessage(code: string): CrownErrorCode | null {
  const upperCode = code?.toUpperCase();
  return CROWN_ERROR_CODES[upperCode] || null;
}

/**
 * 格式化错误消息
 * @param code 错误代码
 * @param originalMessage 原始错误消息
 * @returns 格式化后的错误消息
 */
export function formatCrownError(code?: string, originalMessage?: string): string {
  if (!code) {
    return originalMessage || '下注失败';
  }

  const errorInfo = getCrownErrorMessage(code);
  if (errorInfo) {
    return `[${errorInfo.code}] ${errorInfo.message}`;
  }

  return originalMessage || `未知错误代码: ${code}`;
}

/**
 * 判断错误是否可重试
 * @param code 错误代码
 * @returns 是否可重试
 */
export function isRetryableError(code: string): boolean {
  const errorInfo = getCrownErrorMessage(code);
  if (!errorInfo) {
    return false;
  }

  // 网络错误和系统忙碌可以重试
  return errorInfo.category === 'network' || errorInfo.category === 'status';
}

/**
 * 获取错误类别的中文说明
 * @param category 错误类别
 * @returns 中文说明
 */
export function getErrorCategoryName(category: CrownErrorCode['category']): string {
  const categoryNames: Record<CrownErrorCode['category'], string> = {
    network: '网络错误',
    validation: '验证错误',
    limit: '限额错误',
    status: '状态错误',
    balance: '余额错误',
    odds: '赔率变化',
    other: '其他错误',
  };

  return categoryNames[category] || '未知错误';
}

