import { Router } from "express";
import type { Request, Response } from "express";
import { Notification } from "../Models/Notification";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { MessageModel } from "../Models/Message";
import { authenticateToken } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/auth.middleware";
import mongoose from "mongoose";

const router = Router();

// Admin: get ALL unread new_register notifications for ALL admins
router.get("/admin/new-register/unread", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const admins = await User.find({ role: "admin", status: true }).select("_id").lean();
    const adminIds = admins.map((a: any) => a._id);

    const notificationsRaw = await Notification.find({
      id_receiver: { $in: adminIds },
      type: "new_register",
      is_read: false,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const notifications = await Promise.all(
      notificationsRaw.map(async (notif: any) => {
        let sender = await User.findById(notif.id_sender).select("firstName lastName email").lean();
        if (!sender) {
          sender = await Workshop.findById(notif.id_sender).select("name email").lean();
        }
        return {
          ...notif,
          id_sender: sender,
          id_receiver: notif.id_receiver, // keep receiver so UI can show which admin owns it if needed
        };
      })
    );

    // Deduplicate shared notifications (same registration replicated per admin)
    // Keep only one item per sender+message+type, newest first.
    const seen = new Set<string>();
    const deduped = notifications.filter((n: any) => {
      const senderId = notificationsRaw.find((r: any) => r._id?.toString() === n._id?.toString())?.id_sender?.toString() || "";
      const key = `${n.type}|${senderId}|${n.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.status(200).json({
      ok: true,
      admins: adminIds.map((id: any) => id.toString()),
      notifications: deduped.map((n: any) => ({ ...n, id: n._id?.toString() })),
    });
  } catch (err: any) {
    console.error("Get admin new-register unread notifications error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { all, type } = req.query;

    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }

    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const query: any = { id_receiver: userIdObjectId };
    if (userRole !== 'admin' || all !== 'true') {
      query.is_read = false;
    }
    if (type && typeof type === 'string') {
      query.type = type;
    }

    const notificationsRaw = await Notification.find(query).sort({ createdAt: -1 }).limit(50).lean();
    const notifications = await Promise.all(notificationsRaw.map(async (notif: any) => {
      let sender = await User.findById(notif.id_sender).select('firstName lastName email').lean();
      if (!sender) {
        sender = await Workshop.findById(notif.id_sender).select('name email').lean();
      }
      return { ...notif, id_sender: sender };
    }));

    return res.status(200).json({
      ok: true,
      notifications: notifications.map(notif => ({ ...notif, id: notif._id?.toString() })),
    });
  } catch (err: any) {
    console.error("Get notifications error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

router.put("/:id/read", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const notificationId = req.params.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ ok: false, message: "Notification non trouvÃ©e" });
    }
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const isSharedAdminRegisterRead = userRole === "admin" && notification.type === "new_register";

    // For normal notifications, only receiver can mark as read.
    // For shared admin new_register notifications, any admin can mark the group as read.
    if (!isSharedAdminRegisterRead && notification.id_receiver.toString() !== userIdObjectId.toString()) {
      return res.status(403).json({ ok: false, message: "Vous n'avez pas le droit de modifier cette notification" });
    }
    // Shared admin notifications: one "new_register" is duplicated per admin.
    // Mark all duplicates as read together so it appears only once and disappears once read.
    if (isSharedAdminRegisterRead) {
      await Notification.updateMany(
        {
          type: "new_register",
          id_sender: notification.id_sender,
          message: notification.message,
          is_read: false,
        },
        { is_read: true }
      );

      // Notify all connected admins to refresh shared new_register notifications
      const io = (global as any).io;
      if (io) {
        io.to("admins").emit("admin_notifications_updated", {
          type: "new_register",
          action: "read",
          message: notification.message,
          senderId: notification.id_sender?.toString?.() || notification.id_sender,
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
    notification.is_read = true;
    await notification.save();
    }

    // If this is a message notification, also mark related messages as read
    if (notification.type === 'message') {
      const senderIdObjectId = mongoose.Types.ObjectId.isValid(notification.id_sender) 
        ? new mongoose.Types.ObjectId(notification.id_sender) 
        : notification.id_sender;
      
      // Mark all unread messages from this sender to this receiver as read
      await MessageModel.updateMany(
        {
          id_sender: senderIdObjectId,
          id_reciver: userIdObjectId,
          read: false
        },
        {
          read: true
        }
      );
    }

    return res.status(200).json({ ok: true, message: "Notification marquÃ©e comme lue", notification: notification.toJSON() });
  } catch (err: any) {
    console.error("Mark notification as read error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

router.put("/read-all", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    
    // Mark all notifications as read
    await Notification.updateMany({ id_receiver: userIdObjectId, is_read: false }, { is_read: true });
    
    // Also mark all unread messages to this user as read
    await MessageModel.updateMany(
      {
        id_reciver: userIdObjectId,
        read: false
      },
      {
        read: true
      }
    );
    
    // For admin shared register notifications, broadcast refresh event to all admins
    if (userRole === "admin") {
      const io = (global as any).io;
      if (io) {
        io.to("admins").emit("admin_notifications_updated", {
          type: "new_register",
          action: "read_all",
          updatedAt: new Date().toISOString(),
        });
      }
    }
    
    return res.status(200).json({ ok: true, message: "Toutes les notifications ont Ã©tÃ© marquÃ©es comme lues" });
  } catch (err: any) {
    console.error("Mark all notifications as read error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

router.put("/read-all-messages", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    await Notification.updateMany({ id_receiver: userIdObjectId, type: 'message', is_read: false }, { is_read: true });
    return res.status(200).json({ ok: true, message: "Toutes les notifications de message ont Ã©tÃ© marquÃ©es comme lues" });
  } catch (err: any) {
    console.error("Mark all message notifications as read error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

router.put("/read-chat-messages/:otherUserId", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const otherUserId = req.params.otherUserId;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }
    if (!otherUserId) {
      return res.status(400).json({ ok: false, message: "ID de l'autre utilisateur requis" });
    }
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const otherUserIdObjectId = mongoose.Types.ObjectId.isValid(otherUserId) ? new mongoose.Types.ObjectId(otherUserId) : otherUserId;
    await Notification.updateMany({ id_receiver: userIdObjectId, id_sender: otherUserIdObjectId, type: 'message', is_read: false }, { is_read: true });
    return res.status(200).json({ ok: true, message: "Notifications de message marquÃ©es comme lues" });
  } catch (err: any) {
    console.error("Mark chat message notifications as read error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

export default router;

