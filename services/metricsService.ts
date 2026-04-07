import { Car } from '../Models/Car';
import { User } from '../Models/User';
import { Workshop } from '../Models/Workshop';
import { MessageModel } from '../Models/Message';
import { Notification } from '../Models/Notification';
import { RendezVousWorkshop } from '../Models/RendezVousWorkshop';
import { logger } from '../utils/logger';

export interface AppMetrics {
  // Business metrics
  cars: {
    total: number;
    active: number;
    sold: number;
    pending: number;
  };
  users: {
    total: number;
    active: number;
    verified: number;
    subscribers: number;
  };
  workshops: {
    total: number;
    active: number;
    certified: number;
  };
  messages: {
    total: number;
    unread: number;
    todayCount: number;
  };
  notifications: {
    total: number;
    unread: number;
    todayCount: number;
  };
  appointments: {
    total: number;
    pending: number;
    completed: number;
    todayCount: number;
  };
  // System metrics
  system: {
    uptime: number;
    timestamp: string;
    version: string;
  };
}

export class MetricsService {
  private static metricsCache: { data: AppMetrics; timestamp: number } | null = null;
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Collect all application metrics
   */
  static async collectMetrics(): Promise<AppMetrics> {
    // Check cache first
    if (this.metricsCache && Date.now() - this.metricsCache.timestamp < this.CACHE_TTL) {
      logger.debug({
        msg: 'Metrics served from cache',
      });
      return this.metricsCache.data;
    }

    const startTime = Date.now();
    
    try {
      // Calculate today's date range for daily metrics
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Collect all metrics in parallel for better performance
      const [
        carMetrics,
        userMetrics,
        workshopMetrics,
        messageMetrics,
        notificationMetrics,
        appointmentMetrics,
      ] = await Promise.all([
        // Car metrics
        Promise.all([
          Car.countDocuments(),
          Car.countDocuments({ status: 'actif' }),
          Car.countDocuments({ status: 'sold' }),
          Car.countDocuments({ status: { $in: ['no_proccess', 'en_attente'] } }),
        ]).then(([total, active, sold, pending]) => ({ total, active, sold, pending })),

        // User metrics
        Promise.all([
          User.countDocuments(),
          User.countDocuments({ status: true }),
          User.countDocuments({ verfie: true }),
          User.countDocuments({ status: true, verfie: true }), // Active subscribers
        ]).then(([total, active, verified, subscribers]) => ({ total, active, verified, subscribers })),

        // Workshop metrics
        Promise.all([
          Workshop.countDocuments(),
          Workshop.countDocuments({ status: true }),
          Workshop.countDocuments({ certifie: true }),
        ]).then(([total, active, certified]) => ({ total, active, certified })),

        // Message metrics
        Promise.all([
          MessageModel.countDocuments(),
          MessageModel.countDocuments({ read: false }),
          MessageModel.countDocuments({ 
            createdAt: { $gte: today, $lt: tomorrow } 
          }),
        ]).then(([total, unread, todayCount]) => ({ total, unread, todayCount })),

        // Notification metrics
        Promise.all([
          Notification.countDocuments(),
          Notification.countDocuments({ is_read: false }),
          Notification.countDocuments({ 
            createdAt: { $gte: today, $lt: tomorrow } 
          }),
        ]).then(([total, unread, todayCount]) => ({ total, unread, todayCount })),

        // Appointment metrics
        Promise.all([
          RendezVousWorkshop.countDocuments(),
          RendezVousWorkshop.countDocuments({ status: 'en_attente' }),
          RendezVousWorkshop.countDocuments({ status: 'finish' }),
          RendezVousWorkshop.countDocuments({ 
            createdAt: { $gte: today, $lt: tomorrow } 
          }),
        ]).then(([total, pending, completed, todayCount]) => ({ total, pending, completed, todayCount })),
      ]);

      const metrics: AppMetrics = {
        cars: carMetrics,
        users: userMetrics,
        workshops: workshopMetrics,
        messages: messageMetrics,
        notifications: notificationMetrics,
        appointments: appointmentMetrics,
        system: {
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          version: process.env.npm_package_version || '1.0.0',
        },
      };

      // Cache the result
      this.metricsCache = {
        data: metrics,
        timestamp: Date.now(),
      };

      const duration = Date.now() - startTime;
      logger.info({
        duration,
        msg: 'Metrics collected and cached',
      });

      return metrics;
    } catch (error) {
      logger.error({
        error,
        duration: Date.now() - startTime,
        msg: 'Error collecting metrics',
      });
      throw error;
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  static async exportPrometheusMetrics(): Promise<string> {
    try {
      const metrics = await this.collectMetrics();
      const lines: string[] = [];

      // Add metadata
      lines.push('# HELP cars_total Total number of cars in system');
      lines.push('# TYPE cars_total counter');
      lines.push(`cars_total ${metrics.cars.total}`);
      lines.push('');

      lines.push('# HELP cars_active Number of active cars');
      lines.push('# TYPE cars_active gauge');
      lines.push(`cars_active ${metrics.cars.active}`);
      lines.push('');

      lines.push('# HELP cars_sold Number of sold cars');
      lines.push('# TYPE cars_sold counter');
      lines.push(`cars_sold ${metrics.cars.sold}`);
      lines.push('');

      lines.push('# HELP users_total Total number of users');
      lines.push('# TYPE users_total counter');
      lines.push(`users_total ${metrics.users.total}`);
      lines.push('');

      lines.push('# HELP users_active Number of active users');
      lines.push('# TYPE users_active gauge');
      lines.push(`users_active ${metrics.users.active}`);
      lines.push('');

      lines.push('# HELP workshops_total Total number of workshops');
      lines.push('# TYPE workshops_total counter');
      lines.push(`workshops_total ${metrics.workshops.total}`);
      lines.push('');

      lines.push('# HELP workshops_active Number of active workshops');
      lines.push('# TYPE workshops_active gauge');
      lines.push(`workshops_active ${metrics.workshops.active}`);
      lines.push('');

      lines.push('# HELP messages_total Total number of messages');
      lines.push('# TYPE messages_total counter');
      lines.push(`messages_total ${metrics.messages.total}`);
      lines.push('');

      lines.push('# HELP messages_unread Number of unread messages');
      lines.push('# TYPE messages_unread gauge');
      lines.push(`messages_unread ${metrics.messages.unread}`);
      lines.push('');

      lines.push('# HELP notifications_total Total number of notifications');
      lines.push('# TYPE notifications_total counter');
      lines.push(`notifications_total ${metrics.notifications.total}`);
      lines.push('');

      lines.push('# HELP notifications_unread Number of unread notifications');
      lines.push('# TYPE notifications_unread gauge');
      lines.push(`notifications_unread ${metrics.notifications.unread}`);
      lines.push('');

      lines.push('# HELP appointments_total Total number of appointments');
      lines.push('# TYPE appointments_total counter');
      lines.push(`appointments_total ${metrics.appointments.total}`);
      lines.push('');

      lines.push('# HELP appointments_pending Number of pending appointments');
      lines.push('# TYPE appointments_pending gauge');
      lines.push(`appointments_pending ${metrics.appointments.pending}`);
      lines.push('');

      lines.push('# HELP system_uptime_seconds System uptime in seconds');
      lines.push('# TYPE system_uptime_seconds counter');
      lines.push(`system_uptime_seconds ${metrics.system.uptime}`);
      lines.push('');

      return lines.join('\n');
    } catch (error) {
      logger.error({
        error,
        msg: 'Error exporting Prometheus metrics',
      });
      throw error;
    }
  }

  /**
   * Get metrics summary for admin dashboard
   */
  static async getMetricsSummary(): Promise<{
    summary: any;
    trends: any;
    alerts: string[];
  }> {
    try {
      const metrics = await this.collectMetrics();
      
      // Calculate some trends and alerts
      const alerts: string[] = [];
      
      // Alert if too many unread notifications
      if (metrics.notifications.unread > 100) {
        alerts.push(`High unread notifications: ${metrics.notifications.unread}`);
      }
      
      // Alert if too many unread messages
      if (metrics.messages.unread > 500) {
        alerts.push(`High unread messages: ${metrics.messages.unread}`);
      }
      
      // Alert if low workshop coverage
      if (metrics.workshops.active < 5) {
        alerts.push(`Low workshop count: ${metrics.workshops.active}`);
      }

      const summary = {
        totalActivity: metrics.cars.total + metrics.messages.total + metrics.appointments.total,
        activeUsers: metrics.users.active,
        healthScore: alerts.length === 0 ? 100 : Math.max(0, 100 - alerts.length * 20),
      };

      const trends = {
        dailyMessages: metrics.messages.todayCount,
        dailyNotifications: metrics.notifications.todayCount,
        dailyAppointments: metrics.appointments.todayCount,
        conversionRate: metrics.cars.sold / Math.max(metrics.cars.total, 1) * 100,
      };

      return {
        summary,
        trends,
        alerts,
      };
    } catch (error) {
      logger.error({
        error,
        msg: 'Error getting metrics summary',
      });
      throw error;
    }
  }
}