import { Router } from "express";
import type { Request, Response } from "express";
import { Notification } from "../Models/Notification";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

// Get user's notifications
router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;
      const userRole = req.user?.role;
      const { all } = req.query; // Query parameter to get all notifications (for admin)

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      // For admin, get all notifications if 'all' query param is true, otherwise only unread
      const query: any = { id_receiver: userId };
      if (userRole !== 'admin' || all !== 'true') {
        query.is_read = false; // Only unread notifications for non-admin or when 'all' is not specified
      }

      // Fetch notifications and populate sender manually
      const notificationsRaw = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      // Populate sender information - try User first, then Workshop
      const notifications = await Promise.all(
        notificationsRaw.map(async (notif: any) => {
          let sender = null;
          // Try to find in User model first
          sender = await User.findById(notif.id_sender).select('firstName lastName email').lean();
          // If not found in User, try Workshop
          if (!sender) {
            sender = await Workshop.findById(notif.id_sender).select('name email').lean();
          }
          return {
            ...notif,
            id_sender: sender,
          };
        })
      );

      return res.status(200).json({
        ok: true,
        notifications: notifications.map(notif => ({
          ...notif,
          id: notif._id?.toString(),
        })),
      });
    } catch (err: any) {
      console.error("Get notifications error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Mark notification as read
router.put(
  "/:id/read",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const notificationId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      const notification = await Notification.findById(notificationId);

      if (!notification) {
        return res.status(404).json({
          ok: false,
          message: "Notification non trouvée",
        });
      }

      // Verify notification belongs to user
      if (notification.id_receiver.toString() !== userId) {
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de modifier cette notification",
        });
      }

      notification.is_read = true;
      await notification.save();

      return res.status(200).json({
        ok: true,
        message: "Notification marquée comme lue",
        notification: notification.toJSON(),
      });
    } catch (err: any) {
      console.error("Mark notification as read error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Mark all notifications as read
router.put(
  "/read-all",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      await Notification.updateMany(
        { id_receiver: userId, is_read: false },
        { is_read: true }
      );

      return res.status(200).json({
        ok: true,
        message: "Toutes les notifications ont été marquées comme lues",
      });
    } catch (err: any) {
      console.error("Mark all notifications as read error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Mark all message notifications as read
router.put(
  "/read-all-messages",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      await Notification.updateMany(
        { id_receiver: userId, type: 'message', is_read: false },
        { is_read: true }
      );

      return res.status(200).json({
        ok: true,
        message: "Toutes les notifications de message ont été marquées comme lues",
      });
    } catch (err: any) {
      console.error("Mark all message notifications as read error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Mark message notifications for a specific chat as read
router.put(
  "/read-chat-messages/:otherUserId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const otherUserId = req.params.otherUserId;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      if (!otherUserId) {
        return res.status(400).json({
          ok: false,
          message: "ID de l'autre utilisateur requis",
        });
      }

      // Mark all message notifications from this user as read
      await Notification.updateMany(
        { 
          id_receiver: userId, 
          id_sender: otherUserId,
          type: 'message', 
          is_read: false 
        },
        { is_read: true }
      );

      return res.status(200).json({
        ok: true,
        message: "Notifications de message marquées comme lues",
      });
    } catch (err: any) {
      console.error("Mark chat message notifications as read error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

export default router;
