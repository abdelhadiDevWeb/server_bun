import { Router } from "express";
import type { Request, Response } from "express";
import { Notification } from "../Models/Notification";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { MessageModel } from "../Models/Message";
import { authenticateToken } from "../middleware/auth.middleware";
import mongoose from "mongoose";

const router = Router();

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { all } = req.query;

    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }

    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const query: any = { id_receiver: userIdObjectId };
    if (userRole !== 'admin' || all !== 'true') {
      query.is_read = false;
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
    const notificationId = req.params.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifiÃ©" });
    }
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ ok: false, message: "Notification non trouvÃ©e" });
    }
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    if (notification.id_receiver.toString() !== userIdObjectId.toString()) {
      return res.status(403).json({ ok: false, message: "Vous n'avez pas le droit de modifier cette notification" });
    }
    notification.is_read = true;
    await notification.save();

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

