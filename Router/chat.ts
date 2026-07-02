import { Router } from "express";
import type { Request, Response } from "express";
import { ChatModel } from "../Models/Chat";
import { MessageModel } from "../Models/Message";
import { Notification } from "../Models/Notification";
import { User } from "../Models/User";
import { authenticateToken } from "../middleware/auth.middleware";
import { sendPushNotification } from "../services/pushNotificationService";
import { messagingRateLimiter } from "../middleware/enhancedSecurity.middleware";
import { 
  MessageIdempotencyManager, 
  EventCoalescingManager, 
  BackpressureManager 
} from "../utils/messageIdempotency";
import { logUserAction } from "../utils/logger";
import { CachingService } from "../services/cachingService";
import mongoose from "mongoose";

const router = Router();

function toObjectId(id: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId | string {
  return mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : id;
}

function getPopulatedUserId(user: any): string {
  if (!user) return "";
  if (typeof user === "string") return user;
  return user._id?.toString() || user.id?.toString() || String(user);
}

function serializePopulatedUser(user: any) {
  const id = getPopulatedUserId(user);
  if (typeof user === "object" && user !== null && (user.firstName !== undefined || user.name !== undefined)) {
    return {
      id,
      firstName: user.firstName || user.name?.split(" ")?.[0] || "",
      lastName: user.lastName || user.name?.split(" ")?.slice(1).join(" ") || "",
      email: user.email || "",
      profileImage: user.profileImage || null,
    };
  }
  return { id, firstName: "", lastName: "", email: "", profileImage: null };
}

function serializeMessage(msg: any) {
  return {
    id: msg._id?.toString() || msg.id,
    id_Chat: msg.id_Chat?.toString?.() || String(msg.id_Chat),
    message: msg.message,
    id_sender: serializePopulatedUser(msg.id_sender),
    id_reciver: serializePopulatedUser(msg.id_reciver),
    read: msg.read,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

async function findChatsBetweenUsers(userId: string, otherUserId: string) {
  const u1 = toObjectId(userId);
  const u2 = toObjectId(otherUserId);
  return ChatModel.find({
    $or: [
      { id_user1: u1, id_user2: u2 },
      { id_user1: u2, id_user2: u1 },
    ],
  }).sort({ updatedAt: -1 });
}

async function mergeDuplicateChats(chats: any[]) {
  if (chats.length <= 1) return chats[0] || null;

  const primary = chats[0];
  const duplicateIds = chats.slice(1).map((c) => c._id);

  await MessageModel.updateMany(
    { id_Chat: { $in: duplicateIds } },
    { $set: { id_Chat: primary._id } }
  );
  await ChatModel.deleteMany({ _id: { $in: duplicateIds } });

  const latestMessage = await MessageModel.findOne({ id_Chat: primary._id })
    .sort({ createdAt: -1 })
    .select("createdAt")
    .lean();
  if (latestMessage?.createdAt) {
    await ChatModel.findByIdAndUpdate(primary._id, { updatedAt: latestMessage.createdAt });
  }

  return primary;
}

async function resolveChatBetweenUsers(userId: string, otherUserId: string) {
  const existingChats = await findChatsBetweenUsers(userId, otherUserId);
  if (existingChats.length > 0) {
    return mergeDuplicateChats(existingChats);
  }

  const u1 = toObjectId(userId);
  const u2 = toObjectId(otherUserId);
  try {
    return await ChatModel.create({ id_user1: u1, id_user2: u2 });
  } catch {
    const retryChats = await findChatsBetweenUsers(userId, otherUserId);
    if (retryChats.length > 0) {
      return mergeDuplicateChats(retryChats);
    }
    throw new Error("Impossible de créer le chat");
  }
}

async function markChatReadForUser(chatId: string, userId: string): Promise<void> {
  const chat = await ChatModel.findById(chatId).lean();
  if (!chat) return;

  const otherUserId =
    chat.id_user1.toString() === userId
      ? chat.id_user2.toString()
      : chat.id_user1.toString();

  await MessageModel.updateMany(
    { id_Chat: chatId, id_reciver: userId, read: false },
    { read: true }
  );

  const userIdObjectId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const otherUserIdObjectId = mongoose.Types.ObjectId.isValid(otherUserId)
    ? new mongoose.Types.ObjectId(otherUserId)
    : otherUserId;

  await Notification.updateMany(
    {
      id_receiver: userIdObjectId,
      id_sender: otherUserIdObjectId,
      type: "message",
      is_read: false,
    },
    { is_read: true }
  );

  try {
    await Promise.all([
      CachingService.invalidateCache("notifications"),
      CachingService.invalidateCache("messages"),
    ]);
  } catch {
    // non-fatal
  }
}

// Chat system health check endpoint
router.get("/health", authenticateToken, async (req: Request, res: Response) => {
  try {
    // Only admin users can access this endpoint
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, message: "Accès non autorisé" });
    }

    const backpressureStatus = BackpressureManager.getStatus();
    const coalescingStats = EventCoalescingManager.getStats();

    return res.json({
      ok: true,
      chatSystem: {
        backpressure: backpressureStatus,
        eventCoalescing: coalescingStats,
        timestamp: new Date().toISOString(),
      }
    });
  } catch (error: any) {
    console.error("Error getting chat system health:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur" });
  }
});

// Get or create chat between two users
router.post("/get-or-create", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    const { otherUserId } = req.body;
    if (!otherUserId) {
      return res.status(400).json({ ok: false, message: "ID de l'autre utilisateur requis" });
    }

    if (String(userId) === String(otherUserId)) {
      return res.status(400).json({ ok: false, message: "Vous ne pouvez pas créer un chat avec vous-même" });
    }

    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ ok: false, message: "Utilisateur introuvable" });
    }

    const chat = await resolveChatBetweenUsers(userId, otherUserId);
    await chat.populate("id_user1", "firstName lastName email profileImage");
    await chat.populate("id_user2", "firstName lastName email profileImage");

    const chatId = chat._id?.toString() || chat.id;
    const messages = await MessageModel.find({ id_Chat: chat._id })
      .populate("id_sender", "firstName lastName email profileImage")
      .populate("id_reciver", "firstName lastName email profileImage")
      .sort({ createdAt: 1 });

    await markChatReadForUser(chatId, userId);

    return res.json({
      ok: true,
      chat: {
        id: chatId,
        id_user1: serializePopulatedUser(chat.id_user1),
        id_user2: serializePopulatedUser(chat.id_user2),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
      messages: messages.map(serializeMessage),
    });
  } catch (error: any) {
    console.error("Error getting or creating chat:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

// Get all chats for a user
router.get("/my-chats", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    console.log("Fetching chats for user:", userId);

    const userObjectId = toObjectId(userId);
    const chats = await ChatModel.find({
      $or: [{ id_user1: userObjectId }, { id_user2: userObjectId }],
    })
      .populate('id_user1', 'firstName lastName email profileImage')
      .populate('id_user2', 'firstName lastName email profileImage')
      .sort({ updatedAt: -1 });

    console.log(`Found ${chats.length} chats for user ${userId}`);

    const pairMap = new Map<string, any[]>();
    for (const chat of chats) {
      const id1 = chat.id_user1._id?.toString() || chat.id_user1.toString();
      const id2 = chat.id_user2._id?.toString() || chat.id_user2.toString();
      const pairKey = [id1, id2].sort().join(":");
      if (!pairMap.has(pairKey)) pairMap.set(pairKey, []);
      pairMap.get(pairKey)!.push(chat);
    }
    let mergedDuplicates = false;
    for (const pairChats of pairMap.values()) {
      if (pairChats.length > 1) {
        await mergeDuplicateChats(pairChats);
        mergedDuplicates = true;
      }
    }

    const refreshedChats = mergedDuplicates
      ? await ChatModel.find({
          $or: [{ id_user1: userObjectId }, { id_user2: userObjectId }],
        })
          .populate("id_user1", "firstName lastName email profileImage")
          .populate("id_user2", "firstName lastName email profileImage")
          .sort({ updatedAt: -1 })
      : chats;

    // Get last message and unread count for each chat
    const chatsWithLastMessage = await Promise.all(
      refreshedChats.map(async (chat) => {
        // Convert both to string for comparison
        const user1Id = chat.id_user1._id ? chat.id_user1._id.toString() : chat.id_user1.toString();
        const user2Id = chat.id_user2._id ? chat.id_user2._id.toString() : chat.id_user2.toString();
        const currentUserId = userId.toString();

        // Get last message
        const lastMessage = await MessageModel.findOne({ id_Chat: chat._id })
          .sort({ createdAt: -1 })
          .populate('id_sender', 'firstName lastName email profileImage');

        // Determine the other user (the one who is NOT the current user)
        let otherUser;
        if (user1Id === currentUserId) {
          otherUser = chat.id_user2;
        } else if (user2Id === currentUserId) {
          otherUser = chat.id_user1;
        } else {
          // This shouldn't happen, but handle it gracefully
          console.warn(`User ${currentUserId} not found in chat ${chat._id}`);
          return null;
        }

        // Skip if otherUser is not populated properly
        if (!otherUser || !otherUser._id) {
          console.warn(`Other user not found for chat ${chat._id}`);
          return null;
        }

        // Get unread count - messages where current user is receiver and read: false
        const unreadMessageCount = await MessageModel.countDocuments({
          id_Chat: chat._id,
          id_reciver: currentUserId,
          read: false
        });

        return {
          id: chat.id,
          otherUser: {
            id: otherUser._id ? otherUser._id.toString() : otherUser.toString(),
            firstName: otherUser.firstName || '',
            lastName: otherUser.lastName || '',
            email: otherUser.email || '',
            profileImage: otherUser.profileImage || null
          },
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            message: lastMessage.message,
            id_sender: {
              id: lastMessage.id_sender._id ? lastMessage.id_sender._id.toString() : lastMessage.id_sender.toString(),
              firstName: lastMessage.id_sender.firstName || '',
              lastName: lastMessage.id_sender.lastName || ''
            },
            createdAt: lastMessage.createdAt
          } : null,
          unreadCount: unreadMessageCount, // Use actual unread message count (read: false)
          updatedAt: chat.updatedAt
        };
      })
    );

    const validChats = chatsWithLastMessage.filter((chat) => chat !== null);

    const chatsByOtherUser = new Map<string, (typeof validChats)[number]>();
    for (const chat of validChats) {
      if (!chat) continue;
      const key = chat.otherUser.id;
      const existing = chatsByOtherUser.get(key);
      if (!existing) {
        chatsByOtherUser.set(key, chat);
        continue;
      }
      const existingTime = new Date(existing.updatedAt).getTime();
      const chatTime = new Date(chat.updatedAt).getTime();
      if (chatTime > existingTime) {
        chatsByOtherUser.set(key, chat);
      } else {
        chatsByOtherUser.set(key, {
          ...existing,
          unreadCount: existing.unreadCount + chat.unreadCount,
          lastMessage: existing.lastMessage || chat.lastMessage,
        });
      }
    }

    const dedupedChats = Array.from(chatsByOtherUser.values()).sort(
      (a, b) => new Date(b!.updatedAt).getTime() - new Date(a!.updatedAt).getTime()
    );

    console.log(`Returning ${dedupedChats.length} valid chats`);

    return res.json({
      ok: true,
      chats: dedupedChats,
    });
  } catch (error: any) {
    console.error("Error getting user chats:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

// Send a message
router.post("/send-message", 
  messagingRateLimiter, 
  authenticateToken, 
  async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    const { id_Chat, message, id_reciver, messageId } = req.body;
    
    // Generate message ID if not provided (for idempotency)
    const finalMessageId = messageId || MessageIdempotencyManager.generateMessageId();

    if (!id_Chat || !message || !id_reciver) {
      return res.status(400).json({ ok: false, message: "Tous les champs sont requis" });
    }

    if (!message.trim()) {
      return res.status(400).json({ ok: false, message: "Le message ne peut pas être vide" });
    }

    // Check idempotency - prevent duplicate message processing
    const isAlreadyProcessed = await MessageIdempotencyManager.isMessageProcessed(
      finalMessageId,
      userId,
      id_reciver
    );

    if (isAlreadyProcessed) {
      // Return the existing message status
      const existingStatus = await MessageIdempotencyManager.getMessageStatus(
        finalMessageId,
        userId,
        id_reciver
      );
      
      return res.json({
        ok: true,
        message: "Message déjà traité",
        messageId: finalMessageId,
        duplicate: true,
        processedAt: existingStatus?.timestamp,
      });
    }

    // Check rate limiting
    const rateLimitCheck = await MessageIdempotencyManager.checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        ok: false,
        message: "Limite de messages atteinte. Veuillez ralentir.",
        remainingMessages: rateLimitCheck.remainingMessages,
        retryAfter: 60, // seconds
      });
    }

    // Check backpressure
    const backpressureCheck = BackpressureManager.shouldAcceptEvent();
    if (!backpressureCheck.accept) {
      return res.status(503).json({
        ok: false,
        message: "Système surchargé. Veuillez réessayer.",
        reason: backpressureCheck.reason,
      });
    }

    // Verify chat exists and user is part of it
    const chat = await ChatModel.findById(id_Chat);
    if (!chat) {
      return res.status(404).json({ ok: false, message: "Chat introuvable" });
    }

    const isUserInChat = chat.id_user1.toString() === userId || chat.id_user2.toString() === userId;
    if (!isUserInChat) {
      return res.status(403).json({ ok: false, message: "Vous n'avez pas accès à ce chat" });
    }

    // Verify receiver is the other user in the chat
    const isReceiverValid = chat.id_user1.toString() === id_reciver || chat.id_user2.toString() === id_reciver;
    if (!isReceiverValid) {
      return res.status(400).json({ ok: false, message: "Destinataire invalide" });
    }

    // Mark message as being processed
    await MessageIdempotencyManager.markMessageProcessed(
      finalMessageId,
      userId,
      id_reciver,
      { message: message.trim(), chatId: id_Chat }
    );

    // Create message
    const newMessage = await MessageModel.create({
      id_Chat: id_Chat,
      message: message.trim(),
      id_sender: userId,
      id_reciver: id_reciver
    });

    // Log user action
    logUserAction(
      userId,
      'send_message',
      'chat',
      {
        messageId: finalMessageId,
        chatId: id_Chat,
        receiverId: id_reciver,
        messageLength: message.trim().length,
      },
      req.logger
    );

    // Update chat's updatedAt
    await ChatModel.findByIdAndUpdate(id_Chat, { updatedAt: new Date() });

    // Populate message
    await newMessage.populate('id_sender', 'firstName lastName email profileImage');
    await newMessage.populate('id_reciver', 'firstName lastName email profileImage');

    // Create notification with actual message content
    const notification = await Notification.create({
      id_sender: userId,
      id_receiver: id_reciver,
      message: newMessage.message, // Store the actual message content
      type: 'message'
    });

    // Get sender name for push notification
    const senderName = `${(newMessage.id_sender as any).firstName || ''} ${(newMessage.id_sender as any).lastName || ''}`.trim() || 'Quelqu\'un';

    // Send push notification (works even when app is closed)
    await sendPushNotification(
      id_reciver,
      senderName,
      newMessage.message,
      {
        notificationId: notification.id,
        type: 'message',
        senderId: userId,
        chatId: id_Chat,
      }
    );

    // Send message via socket to receiver using event coalescing
    const io = (global as any).io;
    if (io) {
      try {
        const messageData = {
          ...serializeMessage(newMessage),
          messageId: finalMessageId,
        };

        const notificationId = notification._id?.toString() || notification.id;
        const notificationData = {
          id: notificationId,
          id_sender: {
            id: userId,
            firstName: (newMessage.id_sender as any).firstName,
            lastName: (newMessage.id_sender as any).lastName,
            email: (newMessage.id_sender as any).email,
            profileImage: (newMessage.id_sender as any).profileImage,
          },
          id_receiver: id_reciver,
          message: notification.message,
          type: notification.type,
          is_read: notification.is_read,
          createdAt: notification.createdAt,
        };

        // Use event coalescing for better performance under load
        EventCoalescingManager.emitCoalesced(
          io,
          'new_message',
          messageData,
          `user_${id_reciver}`,
          `message:${id_reciver}:${id_Chat}`
        );

        EventCoalescingManager.emitCoalesced(
          io,
          'new_notification',
          notificationData,
          `user_${id_reciver}`,
          `notification:${id_reciver}:${notificationId}`
        );

        // Record successful event processing
        BackpressureManager.recordSuccess();
      } catch (socketError: any) {
        // Record socket error for backpressure management
        BackpressureManager.recordError(`Socket emission failed: ${socketError.message}`);
        console.error("Socket emission error:", socketError);
        // Continue processing - socket errors shouldn't fail the message creation
      }
    }

    return res.json({
      ok: true,
      messageId: finalMessageId,
      remainingMessages: rateLimitCheck.remainingMessages,
      message: {
        ...serializeMessage(newMessage),
        messageId: finalMessageId,
      },
    });
  } catch (error: any) {
    console.error("Error sending message:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

// Get messages for a chat
router.get("/:chatId/messages", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    const { chatId } = req.params;

    // Verify chat exists and user is part of it
    const chat = await ChatModel.findById(chatId);
    if (!chat) {
      return res.status(404).json({ ok: false, message: "Chat introuvable" });
    }

    const isUserInChat = chat.id_user1.toString() === userId || chat.id_user2.toString() === userId;
    if (!isUserInChat) {
      return res.status(403).json({ ok: false, message: "Vous n'avez pas accès à ce chat" });
    }

    // Get messages
    const messages = await MessageModel.find({ id_Chat: chatId })
      .populate('id_sender', 'firstName lastName email profileImage')
      .populate('id_reciver', 'firstName lastName email profileImage')
      .sort({ createdAt: 1 });

    await markChatReadForUser(chatId, userId);

    return res.json({
      ok: true,
      messages: messages.map(serializeMessage),
    });
  } catch (error: any) {
    console.error("Error getting messages:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

// Mark messages as read
router.put("/:chatId/mark-read", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    const { chatId } = req.params;

    // Verify chat exists and user is part of it
    const chat = await ChatModel.findById(chatId);
    if (!chat) {
      return res.status(404).json({ ok: false, message: "Chat introuvable" });
    }

    const isUserInChat = chat.id_user1.toString() === userId || chat.id_user2.toString() === userId;
    if (!isUserInChat) {
      return res.status(403).json({ ok: false, message: "Vous n'avez pas accès à ce chat" });
    }

    await markChatReadForUser(chatId, userId);

    return res.json({ ok: true, message: "Messages marqués comme lus" });
  } catch (error: any) {
    console.error("Error marking messages as read:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

export default router;
