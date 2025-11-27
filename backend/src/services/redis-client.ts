import Redis from 'ioredis';

/**
 * Redis 客户端服务
 * 用于缓存 Crown API 数据，提升性能
 */
class RedisClient {
  private client: Redis | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.connect();
  }

  /**
   * 连接 Redis
   */
  private connect() {
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      const password = process.env.REDIS_PASSWORD || undefined;

      this.client = new Redis({
        host,
        port,
        password,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
      });

      this.client.on('connect', () => {
        console.log('✅ Redis 连接成功');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis 连接错误:', err.message);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.log('⚠️ Redis 连接关闭');
        this.isConnected = false;
      });

    } catch (error) {
      console.error('❌ Redis 初始化失败:', error);
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * 检查 Redis 是否可用
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * 获取缓存
   */
  async get(key: string): Promise<string | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      return await this.client!.get(key);
    } catch (error) {
      console.error(`❌ Redis GET 失败 (${key}):`, error);
      return null;
    }
  }

  /**
   * 设置缓存（带过期时间）
   */
  async setex(key: string, seconds: number, value: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client!.setex(key, seconds, value);
      return true;
    } catch (error) {
      console.error(`❌ Redis SETEX 失败 (${key}):`, error);
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async del(key: string): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client!.del(key);
      return true;
    } catch (error) {
      console.error(`❌ Redis DEL 失败 (${key}):`, error);
      return false;
    }
  }

  /**
   * 批量删除缓存（支持通配符）
   */
  async delPattern(pattern: string): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }

    try {
      const keys = await this.client!.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      await this.client!.del(...keys);
      return keys.length;
    } catch (error) {
      console.error(`❌ Redis DEL PATTERN 失败 (${pattern}):`, error);
      return 0;
    }
  }

  /**
   * 关闭连接
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }
}

// 单例实例
let redisClientInstance: RedisClient | null = null;

/**
 * 获取 Redis 客户端实例
 */
export function getRedisClient(): RedisClient {
  if (!redisClientInstance) {
    redisClientInstance = new RedisClient();
  }
  return redisClientInstance;
}

/**
 * 关闭 Redis 连接
 */
export async function closeRedisClient() {
  if (redisClientInstance) {
    await redisClientInstance.close();
    redisClientInstance = null;
  }
}

