import { RedisCache } from '../config/redis';
import { logger } from '../utils/logger';
import { Car } from '../Models/Car';
import { Workshop } from '../Models/Workshop';
import { Notification } from '../Models/Notification';
import { MessageModel } from '../Models/Message';
import mongoose from 'mongoose';

export class CachingService {
  // Cache TTL configurations (in seconds)
  private static readonly TTL = {
    ACTIVE_CARS: 5 * 60, // 5 minutes - cars list changes frequently
    WORKSHOPS: 30 * 60, // 30 minutes - workshops don't change often
    USER_NOTIFICATIONS_COUNT: 2 * 60, // 2 minutes - notifications are time-sensitive
    UNREAD_MESSAGES_COUNT: 1 * 60, // 1 minute - messages are very time-sensitive
    CAR_SEARCH_FACETS: 10 * 60, // 10 minutes - search filters
    HOT_CARS: 15 * 60, // 15 minutes - trending/popular cars
    USER_PROFILE: 60 * 60, // 1 hour - user profiles don't change often
  };

  /**
   * Get active cars with caching
   */
  static async getActiveCars(
    filters: any = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{ cars: any[]; totalCount: number; fromCache: boolean }> {
    const cacheKey = `active_cars:${JSON.stringify(filters)}:${page}:${limit}`;
    
    try {
      // Try to get from cache first
      const cachedData = await RedisCache.get(cacheKey);
      if (cachedData) {
        logger.debug({
          cacheKey,
          msg: 'Active cars retrieved from cache',
        });
        return {
          ...cachedData,
          fromCache: true,
        };
      }

      // Query database
      const query = { status: { $ne: 'vendue' }, ...filters };
      const skip = (page - 1) * limit;
      
      const [cars, totalCount] = await Promise.all([
        Car.find(query)
          .populate('owner', 'firstName lastName email phone certifie')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Car.countDocuments(query),
      ]);

      const result = {
        cars: cars.map((car: any) => ({
          ...car,
          id: car._id?.toString(),
        })),
        totalCount,
        fromCache: false,
      };

      // Cache the result
      await RedisCache.set(cacheKey, result, this.TTL.ACTIVE_CARS);
      
      logger.debug({
        cacheKey,
        carCount: cars.length,
        totalCount,
        msg: 'Active cars cached',
      });

      return result;
    } catch (error) {
      logger.error({
        error,
        cacheKey,
        msg: 'Error getting active cars',
      });
      throw error;
    }
  }

  /**
   * Get active workshops with caching
   */
  static async getActiveWorkshops(): Promise<{ workshops: any[]; fromCache: boolean }> {
    const cacheKey = 'active_workshops';
    
    try {
      // Try cache first
      const cachedData = await RedisCache.get(cacheKey);
      if (cachedData) {
        logger.debug({
          cacheKey,
          msg: 'Workshops retrieved from cache',
        });
        return {
          ...cachedData,
          fromCache: true,
        };
      }

      // Query database
      const workshops = await Workshop.find({ status: true })
        .select('-password')
        .sort({ certifie: -1, name: 1 })
        .lean();

      const result = {
        workshops: workshops.map((workshop: any) => ({
          ...workshop,
          id: workshop._id?.toString(),
        })),
        fromCache: false,
      };

      // Cache the result
      await RedisCache.set(cacheKey, result, this.TTL.WORKSHOPS);
      
      logger.debug({
        cacheKey,
        workshopCount: workshops.length,
        msg: 'Workshops cached',
      });

      return result;
    } catch (error) {
      logger.error({
        error,
        cacheKey,
        msg: 'Error getting workshops',
      });
      throw error;
    }
  }

  /**
   * Get unread notifications count with caching
   */
  static async getUnreadNotificationsCount(
    userId: string
  ): Promise<{ count: number; fromCache: boolean }> {
    const cacheKey = `unread_notifications:${userId}`;
    
    try {
      // Try cache first
      const cachedCount = await RedisCache.get<number>(cacheKey);
      if (cachedCount !== null) {
        logger.debug({
          cacheKey,
          count: cachedCount,
          msg: 'Unread notifications count from cache',
        });
        return {
          count: cachedCount,
          fromCache: true,
        };
      }

      // Query database
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      
      const count = await Notification.countDocuments({
        id_receiver: userIdObjectId,
        is_read: false,
      });

      // Cache the result
      await RedisCache.set(cacheKey, count, this.TTL.USER_NOTIFICATIONS_COUNT);
      
      logger.debug({
        cacheKey,
        count,
        msg: 'Unread notifications count cached',
      });

      return {
        count,
        fromCache: false,
      };
    } catch (error) {
      logger.error({
        error,
        cacheKey,
        userId,
        msg: 'Error getting unread notifications count',
      });
      return { count: 0, fromCache: false };
    }
  }

  /**
   * Get unread messages count with caching
   */
  static async getUnreadMessagesCount(
    userId: string
  ): Promise<{ count: number; fromCache: boolean }> {
    const cacheKey = `unread_messages:${userId}`;
    
    try {
      // Try cache first
      const cachedCount = await RedisCache.get<number>(cacheKey);
      if (cachedCount !== null) {
        logger.debug({
          cacheKey,
          count: cachedCount,
          msg: 'Unread messages count from cache',
        });
        return {
          count: cachedCount,
          fromCache: true,
        };
      }

      // Query database
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      
      const count = await MessageModel.countDocuments({
        id_reciver: userIdObjectId,
        read: false,
      });

      // Cache the result
      await RedisCache.set(cacheKey, count, this.TTL.UNREAD_MESSAGES_COUNT);
      
      logger.debug({
        cacheKey,
        count,
        msg: 'Unread messages count cached',
      });

      return {
        count,
        fromCache: false,
      };
    } catch (error) {
      logger.error({
        error,
        cacheKey,
        userId,
        msg: 'Error getting unread messages count',
      });
      return { count: 0, fromCache: false };
    }
  }

  /**
   * Get car search facets (brands, models, price ranges) with caching
   */
  static async getCarSearchFacets(): Promise<{ facets: any; fromCache: boolean }> {
    const cacheKey = 'car_search_facets';
    
    try {
      // Try cache first
      const cachedFacets = await RedisCache.get(cacheKey);
      if (cachedFacets) {
        logger.debug({
          cacheKey,
          msg: 'Car search facets from cache',
        });
        return {
          facets: cachedFacets,
          fromCache: true,
        };
      }

      // Aggregate database data for facets
      const [brands, priceRanges, yearRanges] = await Promise.all([
        // Get unique brands with counts
        Car.aggregate([
          { $match: { status: { $ne: 'vendue' } } },
          { $group: { _id: '$brand', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        
        // Get price distribution
        Car.aggregate([
          { $match: { status: { $ne: 'vendue' } } },
          {
            $bucket: {
              groupBy: '$price',
              boundaries: [0, 1000000, 2000000, 3000000, 5000000, 10000000, Infinity],
              default: 'Other',
              output: { count: { $sum: 1 } },
            },
          },
        ]),
        
        // Get year distribution
        Car.aggregate([
          { $match: { status: { $ne: 'vendue' } } },
          {
            $bucket: {
              groupBy: '$year',
              boundaries: [2000, 2005, 2010, 2015, 2020, 2025],
              default: 'Other',
              output: { count: { $sum: 1 } },
            },
          },
        ]),
      ]);

      const facets = {
        brands,
        priceRanges,
        yearRanges,
        lastUpdated: new Date().toISOString(),
      };

      // Cache the result
      await RedisCache.set(cacheKey, facets, this.TTL.CAR_SEARCH_FACETS);
      
      logger.debug({
        cacheKey,
        brandCount: brands.length,
        msg: 'Car search facets cached',
      });

      return {
        facets,
        fromCache: false,
      };
    } catch (error) {
      logger.error({
        error,
        cacheKey,
        msg: 'Error getting car search facets',
      });
      throw error;
    }
  }

  /**
   * Get hot/trending cars with caching
   */
  static async getHotCars(limit: number = 10): Promise<{ cars: any[]; fromCache: boolean }> {
    const cacheKey = `hot_cars:${limit}`;
    
    try {
      // Try cache first
      const cachedData = await RedisCache.get(cacheKey);
      if (cachedData) {
        logger.debug({
          cacheKey,
          msg: 'Hot cars from cache',
        });
        return {
          ...cachedData,
          fromCache: true,
        };
      }

      // Query database - get recently added cars with high activity
      const cars = await Car.find({
        status: { $in: ['actif', 'en_attente'] },
      })
        .populate('owner', 'firstName lastName certifie')
        .sort({ createdAt: -1 }) // Recently added
        .limit(limit)
        .lean();

      const result = {
        cars: cars.map((car: any) => ({
          ...car,
          id: car._id?.toString(),
        })),
        fromCache: false,
      };

      // Cache the result
      await RedisCache.set(cacheKey, result, this.TTL.HOT_CARS);
      
      logger.debug({
        cacheKey,
        carCount: cars.length,
        msg: 'Hot cars cached',
      });

      return result;
    } catch (error) {
      logger.error({
        error,
        cacheKey,
        msg: 'Error getting hot cars',
      });
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific pattern
   */
  static async invalidateCache(pattern: string): Promise<void> {
    try {
      // Note: Redis doesn't have a built-in wildcard delete
      // In a production environment, you'd use Redis SCAN with pattern matching
      // For now, we'll invalidate specific known keys
      
      if (pattern.includes('cars')) {
        await Promise.all([
          RedisCache.del('active_cars*'), // This would need proper wildcard support
          RedisCache.del('hot_cars*'),
          RedisCache.del('car_search_facets'),
        ]);
      }
      
      if (pattern.includes('notifications')) {
        // Invalidate all notification caches (would need pattern matching in production)
        logger.debug({
          pattern,
          msg: 'Invalidating notification caches',
        });
      }
      
      if (pattern.includes('messages')) {
        // Invalidate all message caches
        logger.debug({
          pattern,
          msg: 'Invalidating message caches',
        });
      }

      logger.info({
        pattern,
        msg: 'Cache invalidated',
      });
    } catch (error) {
      logger.error({
        error,
        pattern,
        msg: 'Error invalidating cache',
      });
    }
  }

  /**
   * Warm up frequently accessed caches
   */
  static async warmUpCaches(): Promise<void> {
    try {
      logger.info({
        msg: 'Starting cache warm-up',
      });

      // Warm up common caches in parallel
      await Promise.all([
        this.getActiveCars(),
        this.getActiveWorkshops(),
        this.getCarSearchFacets(),
        this.getHotCars(),
      ]);

      logger.info({
        msg: 'Cache warm-up completed',
      });
    } catch (error) {
      logger.error({
        error,
        msg: 'Error during cache warm-up',
      });
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{
    activeCarsHits: number;
    workshopsHits: number;
    notificationCountHits: number;
    messageCountHits: number;
  }> {
    try {
      // This is a simplified version - in production you'd track hits/misses
      // with Redis MONITOR or custom counters
      return {
        activeCarsHits: 0,
        workshopsHits: 0,
        notificationCountHits: 0,
        messageCountHits: 0,
      };
    } catch (error) {
      logger.error({
        error,
        msg: 'Error getting cache stats',
      });
      return {
        activeCarsHits: 0,
        workshopsHits: 0,
        notificationCountHits: 0,
        messageCountHits: 0,
      };
    }
  }
}