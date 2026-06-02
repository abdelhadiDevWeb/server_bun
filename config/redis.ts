import { createClient } from 'redis';
import { logger } from '../utils/logger';
import "dotenv/config";

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NODE_ENV = process.env.NODE_ENV || 'development';

/** Set `REDIS_ENABLED=false` in .env to run without Redis (cPanel / single instance). */
export function isRedisEnabled(): boolean {
  const flag = process.env.REDIS_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  if (flag === 'true' || flag === '1' || flag === 'yes') return true;
  return true;
}

// Create Redis client
export const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 10000,
    lazyConnect: true,
  },
  // Connection retry strategy
  retry_strategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn({
      attempt: times,
      delay,
      msg: 'Redis connection retry',
    });
    return delay;
  },
});

// Create separate Redis client for pub/sub (Socket.IO adapter)
export const redisPubClient = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 10000,
    lazyConnect: true,
  },
});

export const redisSubClient = redisPubClient.duplicate();

// Error handling
redisClient.on('error', (err) => {
  logger.error({
    error: err,
    msg: 'Redis client error',
  });
});

redisClient.on('connect', () => {
  logger.info({
    url: REDIS_URL.replace(/\/\/.*@/, '//***@'), // Hide credentials in logs
    msg: 'Redis client connected',
  });
});

redisClient.on('ready', () => {
  logger.info({
    msg: 'Redis client ready',
  });
});

redisClient.on('end', () => {
  logger.info({
    msg: 'Redis client disconnected',
  });
});

// Pub/Sub client event handlers
redisPubClient.on('error', (err) => {
  logger.error({
    error: err,
    msg: 'Redis pub client error',
  });
});

redisSubClient.on('error', (err) => {
  logger.error({
    error: err,
    msg: 'Redis sub client error',
  });
});

/**
 * Connect to Redis
 */
export async function connectRedis(): Promise<void> {
  if (!isRedisEnabled()) {
    logger.info({ msg: 'Redis disabled (REDIS_ENABLED=false), skipping connection' });
    return;
  }

  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    
    if (!redisPubClient.isOpen) {
      await redisPubClient.connect();
    }
    
    if (!redisSubClient.isOpen) {
      await redisSubClient.connect();
    }
    
    logger.info({
      msg: 'All Redis clients connected successfully',
    });
  } catch (error) {
    logger.error({
      error,
      msg: 'Failed to connect to Redis',
    });
    
    logger.warn({
      msg:
        NODE_ENV === 'development'
          ? 'Continuing without Redis in development mode'
          : 'Continuing without Redis (connection failed)',
    });
  }
}

/**
 * Disconnect from Redis
 */
export async function disconnectRedis(): Promise<void> {
  if (!isRedisEnabled()) return;

  try {
    const promises = [];
    
    if (redisClient.isOpen) {
      promises.push(redisClient.disconnect());
    }
    
    if (redisPubClient.isOpen) {
      promises.push(redisPubClient.disconnect());
    }
    
    if (redisSubClient.isOpen) {
      promises.push(redisSubClient.disconnect());
    }
    
    await Promise.all(promises);
    
    logger.info({
      msg: 'All Redis clients disconnected',
    });
  } catch (error) {
    logger.error({
      error,
      msg: 'Error disconnecting Redis clients',
    });
  }
}

/**
 * Check Redis connection health
 */
export async function checkRedisHealth(): Promise<boolean> {
  if (!isRedisEnabled()) return true;

  try {
    if (!redisClient.isOpen) {
      return false;
    }
    
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error({
      error,
      msg: 'Redis health check failed',
    });
    return false;
  }
}

/**
 * Cache wrapper with automatic JSON serialization
 */
export class RedisCache {
  /**
   * Set a value in cache with expiration
   */
  static async set(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    try {
      if (!isRedisEnabled() || !redisClient.isOpen) {
        return;
      }
      
      const serializedValue = JSON.stringify(value);
      await redisClient.setEx(key, ttlSeconds, serializedValue);
      
      logger.debug({
        key,
        ttl: ttlSeconds,
        msg: 'Cache set',
      });
    } catch (error) {
      logger.error({
        error,
        key,
        msg: 'Failed to set cache',
      });
    }
  }

  /**
   * Get a value from cache
   */
  static async get<T = any>(key: string): Promise<T | null> {
    try {
      if (!isRedisEnabled() || !redisClient.isOpen) {
        return null;
      }
      
      const value = await redisClient.get(key);
      
      if (value === null) {
        return null;
      }
      
      const parsedValue = JSON.parse(value);
      
      logger.debug({
        key,
        hit: true,
        msg: 'Cache get',
      });
      
      return parsedValue;
    } catch (error) {
      logger.error({
        error,
        key,
        msg: 'Failed to get cache',
      });
      return null;
    }
  }

  /**
   * Delete a value from cache
   */
  static async del(key: string): Promise<void> {
    try {
      if (!isRedisEnabled() || !redisClient.isOpen) {
        return;
      }
      
      await redisClient.del(key);
      
      logger.debug({
        key,
        msg: 'Cache deleted',
      });
    } catch (error) {
      logger.error({
        error,
        key,
        msg: 'Failed to delete cache',
      });
    }
  }

  /**
   * Check if a key exists in cache
   */
  static async exists(key: string): Promise<boolean> {
    try {
      if (!isRedisEnabled() || !redisClient.isOpen) {
        return false;
      }
      
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      logger.error({
        error,
        key,
        msg: 'Failed to check cache existence',
      });
      return false;
    }
  }
}

export default redisClient;