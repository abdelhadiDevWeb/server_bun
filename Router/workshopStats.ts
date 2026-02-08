import { Router } from "express";
import type { Request, Response } from "express";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { Notification } from "../Models/Notification";
import { authenticateToken } from "../middleware/auth.middleware";
import mongoose from "mongoose";

const router = Router();

// Get workshop statistics
router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || userType !== 'workshop') {
        return res.status(401).json({
          ok: false,
          message: "Atelier non authentifié",
        });
      }

      // Convert userId to ObjectId
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      // Count pending appointments (status: 'en_attente')
      const pendingAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_workshop: userIdObjectId,
        status: 'en_attente'
      });

      // Count total appointments
      const totalAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_workshop: userIdObjectId 
      });

      // Count upcoming appointments (status: 'en_attente' or 'accepted', date >= today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const upcomingAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_workshop: userIdObjectId,
        status: { $in: ['en_attente', 'accepted'] },
        date: { $gte: today }
      });

      // Count appointments this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const appointmentsThisMonth = await RendezVousWorkshop.countDocuments({ 
        id_workshop: userIdObjectId,
        createdAt: { $gte: startOfMonth }
      });

      // Count accepted appointments
      const acceptedAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_workshop: userIdObjectId,
        status: 'accepted'
      });

      // Count refused appointments
      const refusedAppointmentsCount = await RendezVousWorkshop.countDocuments({ 
        id_workshop: userIdObjectId,
        status: 'refused'
      });

      // Count completed appointments (accepted or refused)
      const completedAppointmentsCount = acceptedAppointmentsCount + refusedAppointmentsCount;

      // Get monthly statistics for the last 6 months
      const monthlyStats = [];
      for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        
        const monthAppointments = await RendezVousWorkshop.countDocuments({
          id_workshop: userIdObjectId,
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        });
        
        const monthCompleted = await RendezVousWorkshop.countDocuments({
          id_workshop: userIdObjectId,
          status: { $in: ['accepted', 'refused'] },
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        });
        
        const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
        monthlyStats.push({
          month: monthNames[date.getMonth()],
          appointments: monthAppointments,
          completed: monthCompleted,
        });
      }

      // Get recent appointments (last 5)
      const recentAppointments = await RendezVousWorkshop.find({ 
        id_workshop: userIdObjectId 
      })
        .populate('id_owner_car', 'firstName lastName email phone')
        .populate('id_car', 'brand model year')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      // Calculate completion rate
      const completionRate = totalAppointmentsCount > 0
        ? ((completedAppointmentsCount / totalAppointmentsCount) * 100).toFixed(1)
        : 0;

      return res.status(200).json({
        ok: true,
        stats: {
          pendingAppointments: pendingAppointmentsCount,
          totalAppointments: totalAppointmentsCount,
          upcomingAppointments: upcomingAppointmentsCount,
          appointmentsThisMonth: appointmentsThisMonth,
          acceptedAppointments: acceptedAppointmentsCount,
          refusedAppointments: refusedAppointmentsCount,
          completedAppointments: completedAppointmentsCount,
          completionRate: parseFloat(completionRate),
        },
        monthlyStats,
        recentAppointments: recentAppointments.map(apt => ({
          ...apt,
          id: apt._id?.toString(),
        })),
      });
    } catch (err: any) {
      console.error("Get workshop statistics error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Get today's appointments with progress
router.get(
  "/today",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || userType !== 'workshop') {
        return res.status(401).json({
          ok: false,
          message: "Atelier non authentifié",
        });
      }

      // Convert userId to ObjectId
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all appointments for today
      const todayAppointments = await RendezVousWorkshop.find({
        id_workshop: userIdObjectId,
        date: {
          $gte: today,
          $lte: endOfDay,
        },
      })
        .populate('id_owner_car', 'firstName lastName email phone')
        .populate('id_car', 'brand model year images')
        .sort({ time: 1 }) // Sort by time ascending
        .lean();

      // Count completed (status: 'accepted' or 'refused')
      const completedCount = todayAppointments.filter(
        apt => apt.status === 'accepted' || apt.status === 'refused'
      ).length;

      // Calculate progress percentage
      const totalCount = todayAppointments.length;
      const progressPercentage = totalCount > 0 
        ? Math.round((completedCount / totalCount) * 100) 
        : 0;

      return res.status(200).json({
        ok: true,
        appointments: todayAppointments.map(apt => ({
          ...apt,
          id: apt._id?.toString(),
        })),
        stats: {
          total: totalCount,
          completed: completedCount,
          pending: totalCount - completedCount,
          progress: progressPercentage,
        },
      });
    } catch (err: any) {
      console.error("Get today's appointments error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

export default router;
