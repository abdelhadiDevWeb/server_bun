import { RedisCache } from '../config/redis';
import { logger } from './logger';
import { randomUUID } from 'crypto';

/**
 * Message idempotency manager to prevent duplicate message processing
 * Uses Redis for distributed storage across multiple server instances
 */
export class MessageIdempotencyManager {
  private static readonly IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds
  private static readonly RATE_LIMIT_TTL = 60; // 1 minute in seconds
  private static readonly MAX_MESSAGES_PER_MINUTE = 30;

  /**
   * Generate a unique message ID
   */
  static generateMessageId(): string {
    return `msg_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }

  /**
   * Check if message has already been processed (idempotency check)
   */
  static async isMessageProcessed(
    messageId: string,
    senderId: string,
    receiverId: string
  ): Promise<boolean> {
    try {
      const key = `idempotency:${messageId}:${senderId}:${receiverId}`;
      const exists = await RedisCache.exists(key);
      
      if (exists) {
        logger.warn({
          messageId,
          senderId,
          receiverId,
          msg: 'Duplicate message detected',
        });
      }
      
      return exists;
    } catch (error) {
      logger.error({
        error,
        messageId,
        msg: 'Failed to check message idempotency',
      });
      // If Redis is down, allow the message to prevent blocking
      return false;
    }
  }

  /**
   * Mark message as processed
   */
  static async markMessageProcessed(
    messageId: string,
    senderId: string,
    receiverId: string,
    messageData: any
  ): Promise<void> {
    try {
      const key = `idempotency:${messageId}:${senderId}:${receiverId}`;
      
      // Store message metadata for deduplication
      const metadata = {
        messageId,
        senderId,
        receiverId,
        timestamp: new Date().toISOString(),
        content: messageData.message?.substring(0, 100), // First 100 chars for debugging
        processed: true,
      };
      
      await RedisCache.set(key, metadata, this.IDEMPOTENCY_TTL);
      
      logger.debug({
        messageId,
        key,
        msg: 'Message marked as processed',
      });
    } catch (error) {
      logger.error({
        error,
        messageId,
        msg: 'Failed to mark message as processed',
      });
    }
  }

  /**
   * Check rate limiting for message sending
   */
  static async checkRateLimit(senderId: string): Promise<{ allowed: boolean; remainingMessages: number }> {
    try {
      const key = `rate_limit:messages:${senderId}`;
      const currentCount = await RedisCache.get<number>(key) || 0;
      
      if (currentCount >= this.MAX_MESSAGES_PER_MINUTE) {
        logger.warn({
          senderId,
          currentCount,
          limit: this.MAX_MESSAGES_PER_MINUTE,
          msg: 'Message rate limit exceeded',
        });
        
        return {
          allowed: false,
          remainingMessages: 0,
        };
      }
      
      // Increment counter
      const newCount = currentCount + 1;
      await RedisCache.set(key, newCount, this.RATE_LIMIT_TTL);
      
      return {
        allowed: true,
        remainingMessages: this.MAX_MESSAGES_PER_MINUTE - newCount,
      };
    } catch (error) {
      logger.error({
        error,
        senderId,
        msg: 'Failed to check message rate limit',
      });
      // If Redis is down, allow the message
      return {
        allowed: true,
        remainingMessages: this.MAX_MESSAGES_PER_MINUTE,
      };
    }
  }

  /**
   * Get message processing status
   */
  static async getMessageStatus(
    messageId: string,
    senderId: string,
    receiverId: string
  ): Promise<any> {
    try {
      const key = `idempotency:${messageId}:${senderId}:${receiverId}`;
      return await RedisCache.get(key);
    } catch (error) {
      logger.error({
        error,
        messageId,
        msg: 'Failed to get message status',
      });
      return null;
    }
  }
}

/**
 * Event coalescing manager to reduce redundant socket emissions
 */
export class EventCoalescingManager {
  private static pendingEvents = new Map<string, {
    event: string;
    data: any;
    rooms: Set<string>;
    scheduledAt: number;
    timeout: NodeJS.Timeout;
  }>();
  
  private static readonly COALESCING_DELAY = 50; // 50ms delay for coalescing

  /**
   * Emit event with coalescing to reduce redundant emissions
   */
  static emitCoalesced(
    io: any,
    event: string,
    data: any,
    rooms: string | string[],
    coalescingKey?: string
  ): void {
    const roomsArray = Array.isArray(rooms) ? rooms : [rooms];
    const key = coalescingKey || `${event}:${roomsArray.join(',')}`;
    
    // Cancel existing timeout if event is already pending
    const existingEvent = this.pendingEvents.get(key);
    if (existingEvent) {
      clearTimeout(existingEvent.timeout);
      // Merge room lists
      roomsArray.forEach(room => existingEvent.rooms.add(room));
      // Update data (keep latest)
      existingEvent.data = data;
    } else {
      this.pendingEvents.set(key, {
        event,
        data,
        rooms: new Set(roomsArray),
        scheduledAt: Date.now(),
        timeout: setTimeout(() => {
          this.flushEvent(io, key);
        }, this.COALESCING_DELAY),
      });
    }
    
    logger.debug({
      event,
      key,
      coalescingDelay: this.COALESCING_DELAY,
      msg: 'Event scheduled for coalescing',
    });
  }

  /**
   * Flush a coalesced event immediately
   */
  private static flushEvent(io: any, key: string): void {
    const pendingEvent = this.pendingEvents.get(key);
    if (!pendingEvent) return;

    const { event, data, rooms } = pendingEvent;
    
    try {
      // Emit to all rooms
      rooms.forEach(room => {
        io.to(room).emit(event, data);
      });
      
      logger.debug({
        event,
        rooms: Array.from(rooms),
        coalescedDuration: Date.now() - pendingEvent.scheduledAt,
        msg: 'Coalesced event emitted',
      });
    } catch (error) {
      logger.error({
        error,
        event,
        key,
        msg: 'Failed to emit coalesced event',
      });
    } finally {
      this.pendingEvents.delete(key);
    }
  }

  /**
   * Flush all pending events immediately (useful for shutdown)
   */
  static flushAll(io: any): void {
    logger.info({
      pendingCount: this.pendingEvents.size,
      msg: 'Flushing all pending coalesced events',
    });

    for (const [key] of this.pendingEvents) {
      this.flushEvent(io, key);
    }
  }

  /**
   * Get statistics about pending events
   */
  static getStats(): {
    pendingEvents: number;
    oldestEvent: number | null;
  } {
    if (this.pendingEvents.size === 0) {
      return { pendingEvents: 0, oldestEvent: null };
    }

    let oldestTimestamp = Date.now();
    for (const event of this.pendingEvents.values()) {
      if (event.scheduledAt < oldestTimestamp) {
        oldestTimestamp = event.scheduledAt;
      }
    }

    return {
      pendingEvents: this.pendingEvents.size,
      oldestEvent: oldestTimestamp,
    };
  }
}

/**
 * Backpressure manager to handle high-load scenarios
 */
export class BackpressureManager {
  private static readonly MAX_PENDING_EVENTS = 1000;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 50; // errors per minute
  private static readonly CIRCUIT_BREAKER_RESET_TIME = 60 * 1000; // 1 minute
  
  private static circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private static errorCount = 0;
  private static lastErrorReset = Date.now();
  private static nextCircuitBreakerCheck = 0;

  /**
   * Check if system should accept new events (backpressure control)
   */
  static shouldAcceptEvent(): { accept: boolean; reason?: string } {
    // Check circuit breaker
    if (this.circuitBreakerState === 'OPEN') {
      if (Date.now() > this.nextCircuitBreakerCheck) {
        this.circuitBreakerState = 'HALF_OPEN';
        logger.info({ msg: 'Circuit breaker moving to HALF_OPEN' });
      } else {
        return { accept: false, reason: 'Circuit breaker OPEN' };
      }
    }

    // Check pending events queue
    const stats = EventCoalescingManager.getStats();
    if (stats.pendingEvents > this.MAX_PENDING_EVENTS) {
      this.recordError('Too many pending events');
      return { accept: false, reason: 'Event queue full' };
    }

    return { accept: true };
  }

  /**
   * Record an error for circuit breaker logic
   */
  static recordError(error: string): void {
    const now = Date.now();
    
    // Reset error count if it's been more than a minute
    if (now - this.lastErrorReset > 60 * 1000) {
      this.errorCount = 0;
      this.lastErrorReset = now;
    }
    
    this.errorCount++;
    
    logger.warn({
      error,
      errorCount: this.errorCount,
      circuitBreakerState: this.circuitBreakerState,
      msg: 'Backpressure error recorded',
    });
    
    // Trip circuit breaker if threshold exceeded
    if (this.errorCount >= this.CIRCUIT_BREAKER_THRESHOLD && this.circuitBreakerState === 'CLOSED') {
      this.circuitBreakerState = 'OPEN';
      this.nextCircuitBreakerCheck = now + this.CIRCUIT_BREAKER_RESET_TIME;
      
      logger.error({
        errorCount: this.errorCount,
        msg: 'Circuit breaker OPENED due to high error rate',
      });
    }
  }

  /**
   * Record successful event processing
   */
  static recordSuccess(): void {
    if (this.circuitBreakerState === 'HALF_OPEN') {
      this.circuitBreakerState = 'CLOSED';
      this.errorCount = 0;
      logger.info({ msg: 'Circuit breaker CLOSED after successful operation' });
    }
  }

  /**
   * Get current backpressure status
   */
  static getStatus(): {
    circuitBreakerState: string;
    errorCount: number;
    pendingEvents: number;
  } {
    const stats = EventCoalescingManager.getStats();
    return {
      circuitBreakerState: this.circuitBreakerState,
      errorCount: this.errorCount,
      pendingEvents: stats.pendingEvents,
    };
  }
}