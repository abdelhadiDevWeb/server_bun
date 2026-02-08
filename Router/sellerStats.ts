import { Router } from "express";
import type { Request, Response } from "express";
import { Car } from "../Models/Car";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { Notification } from "../Models/Notification";
import { authenticateToken } from "../middleware/auth.middleware";
import mongoose from "mongoose";

const router = Router();

// Get seller statistics
router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || userType !== 'user') {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      // Convert userId to ObjectId
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      // Count active cars (status: 'actif')
      const activeCarsCount = await Car.countDocuments({ 
        owner: userIdObjectId,
        status: 'actif' 
      });

      // Count all cars
      const totalCarsCount = await Car.countDocuments({ 
        owner: userIdObjectId 
      });

      // Count unread notifications
      const unreadNotificationsCount = await Notification.countDocuments({ 
        id_receiver: userIdObjectId,
        is_read: false 
      });

      // Count total notifications
      const totalNotificationsCount = await Notification.countDocuments({ 
        id_receiver: userIdObjectId 
      });

      // Count appointments
      const totalAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_owner_car: userIdObjectId 
      });

      // Count upcoming appointments (status: 'en_attente' or 'accepted', date >= today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const upcomingAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_owner_car: userIdObjectId,
        status: { $in: ['en_attente', 'accepted'] },
        date: { $gte: today }
      });

      // Get recent appointments (last 5)
      const recentAppointments = await RendezVousWorkshop.find({ 
        id_owner_car: userIdObjectId 
      })
        .populate('id_workshop', 'name')
        .populate('id_car', 'brand model year')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      // Get recent notifications (last 5)
      const recentNotifications = await Notification.find({ 
        id_receiver: userIdObjectId 
      })
        .populate('id_sender', 'name firstName lastName')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      // Count sold cars
      const soldCarsCount = await Car.countDocuments({ 
        owner: userIdObjectId,
        status: 'sold' 
      });

      // Get top cars (most active, ordered by creation date or status)
      const topCars = await Car.find({ 
        owner: userIdObjectId 
      })
        .select('brand model year status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      // Calculate average price of sold cars
      const soldCars = await Car.find({ 
        owner: userIdObjectId,
        status: 'sold' 
      })
        .select('price')
        .lean();

      const averagePrice = soldCars.length > 0
        ? soldCars.reduce((sum, car) => sum + (car.price || 0), 0) / soldCars.length
        : 0;

      // Calculate conversion rate (sold cars / total cars)
      const conversionRate = totalCarsCount > 0
        ? ((soldCarsCount / totalCarsCount) * 100).toFixed(1)
        : 0;

      return res.status(200).json({
        ok: true,
        stats: {
          activeCars: activeCarsCount,
          totalCars: totalCarsCount,
          soldCars: soldCarsCount,
          unreadNotifications: unreadNotificationsCount,
          totalNotifications: totalNotificationsCount,
          totalAppointments: totalAppointmentsCount,
          upcomingAppointments: upcomingAppointmentsCount,
          averagePrice: Math.round(averagePrice),
          conversionRate: parseFloat(conversionRate),
        },
        topCars: topCars.map(car => ({
          ...car,
          id: car._id?.toString(),
          name: `${car.brand} ${car.model} ${car.year}`,
        })),
        recentAppointments: recentAppointments.map(apt => ({
          ...apt,
          id: apt._id?.toString(),
        })),
        recentNotifications: recentNotifications.map(notif => ({
          ...notif,
          id: notif._id?.toString(),
        })),
      });
    } catch (err: any) {
      console.error("Get seller statistics error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

export default router;
