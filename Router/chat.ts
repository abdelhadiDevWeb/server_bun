import { Router } from "express";
import type { Request, Response } from "express";
import { ChatModel } from "../Models/Chat";
import { MessageModel } from "../Models/Message";
import { Notification } from "../Models/Notification";
import { User } from "../Models/User";
import { authenticateToken } from "../middleware/auth.middleware";
import mongoose from "mongoose";

const router = Router();

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

    if (userId === otherUserId) {
      return res.status(400).json({ ok: false, message: "Vous ne pouvez pas créer un chat avec vous-même" });
    }

    // Check if other user exists
    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ ok: false, message: "Utilisateur introuvable" });
    }

    // Try to find existing chat (check both directions)
    let chat = await ChatModel.findOne({
      $or: [
        { id_user1: userId, id_user2: otherUserId },
        { id_user1: otherUserId, id_user2: userId }
      ]
    }).populate('id_user1', 'firstName lastName email profileImage')
      .populate('id_user2', 'firstName lastName email profileImage');

    // If chat doesn't exist, create it
    if (!chat) {
      chat = await ChatModel.create({
        id_user1: userId,
        id_user2: otherUserId
      });
      
      await chat.populate('id_user1', 'firstName lastName email profileImage');
      await chat.populate('id_user2', 'firstName lastName email profileImage');
    }

    // Get messages for this chat
    const messages = await MessageModel.find({ id_Chat: chat._id })
      .populate('id_sender', 'firstName lastName email profileImage')
      .populate('id_reciver', 'firstName lastName email profileImage')
      .sort({ createdAt: 1 });

    return res.json({
      ok: true,
      chat: {
        id: chat.id,
        id_user1: chat.id_user1,
        id_user2: chat.id_user2,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      },
      messages: messages.map(msg => ({
        id: msg.id,
        id_Chat: msg.id_Chat.toString(),
        message: msg.message,
        id_sender: msg.id_sender,
        id_reciver: msg.id_reciver,
        read: msg.read,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt
      }))
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

    // Find all chats where user is either user1 or user2
    // Convert userId to ObjectId if needed for proper comparison
    const chats = await ChatModel.find({
      $or: [
        { id_user1: userId },
        { id_user2: userId }
      ]
    })
      .populate('id_user1', 'firstName lastName email profileImage')
      .populate('id_user2', 'firstName lastName email profileImage')
      .sort({ updatedAt: -1 });

    console.log(`Found ${chats.length} chats for user ${userId}`);

    // Get last message and unread count for each chat
    const chatsWithLastMessage = await Promise.all(
      chats.map(async (chat) => {
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

        // Get unread count - messages where current user is receiver
        const unreadMessageCount = await MessageModel.countDocuments({
          id_Chat: chat._id,
          id_reciver: currentUserId,
          read: false
        });

        // Get unread notification count for this chat (only notifications with is_read: false)
        const otherUserIdString = otherUser._id ? otherUser._id.toString() : otherUser.toString();
        const unreadNotificationCount = await Notification.countDocuments({
          id_receiver: currentUserId,
          id_sender: otherUserIdString,
          type: 'message',
          is_read: false
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
          unreadCount: unreadNotificationCount, // Use notification count instead of message count
          updatedAt: chat.updatedAt
        };
      })
    );

    // Filter out null values (chats that couldn't be processed)
    const validChats = chatsWithLastMessage.filter(chat => chat !== null);

    console.log(`Returning ${validChats.length} valid chats`);

    return res.json({
      ok: true,
      chats: validChats
    });
  } catch (error: any) {
    console.error("Error getting user chats:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

// Send a message
router.post("/send-message", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    const { id_Chat, message, id_reciver } = req.body;

    if (!id_Chat || !message || !id_reciver) {
      return res.status(400).json({ ok: false, message: "Tous les champs sont requis" });
    }

    if (!message.trim()) {
      return res.status(400).json({ ok: false, message: "Le message ne peut pas être vide" });
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

    // Create message
    const newMessage = await MessageModel.create({
      id_Chat: id_Chat,
      message: message.trim(),
      id_sender: userId,
      id_reciver: id_reciver
    });

    // Update chat's updatedAt
    await ChatModel.findByIdAndUpdate(id_Chat, { updatedAt: new Date() });

    // Populate message
    await newMessage.populate('id_sender', 'firstName lastName email profileImage');
    await newMessage.populate('id_reciver', 'firstName lastName email profileImage');

    // Create notification
    const notification = await Notification.create({
      id_sender: userId,
      id_receiver: id_reciver,
      message: `Nouveau message de ${(newMessage.id_sender as any).firstName} ${(newMessage.id_sender as any).lastName}`,
      type: 'message'
    });

    // Send message via socket to receiver
    const io = (global as any).io;
    if (io) {
      io.to(`user_${id_reciver}`).emit('new_message', {
        id: newMessage.id,
        id_Chat: newMessage.id_Chat.toString(),
        message: newMessage.message,
        id_sender: {
          id: (newMessage.id_sender as any).id,
          firstName: (newMessage.id_sender as any).firstName,
          lastName: (newMessage.id_sender as any).lastName,
          email: (newMessage.id_sender as any).email,
          profileImage: (newMessage.id_sender as any).profileImage
        },
        id_reciver: {
          id: (newMessage.id_reciver as any).id,
          firstName: (newMessage.id_reciver as any).firstName,
          lastName: (newMessage.id_reciver as any).lastName,
          email: (newMessage.id_reciver as any).email,
          profileImage: (newMessage.id_reciver as any).profileImage
        },
        read: newMessage.read,
        createdAt: newMessage.createdAt,
        updatedAt: newMessage.updatedAt
      });

      // Send notification via socket
      io.to(`user_${id_reciver}`).emit('new_notification', {
        id: notification.id,
        id_sender: userId,
        id_receiver: id_reciver,
        message: notification.message,
        type: notification.type,
        is_read: notification.is_read,
        createdAt: notification.createdAt
      });
    }

    return res.json({
      ok: true,
      message: {
        id: newMessage.id,
        id_Chat: newMessage.id_Chat.toString(),
        message: newMessage.message,
        id_sender: {
          id: (newMessage.id_sender as any).id,
          firstName: (newMessage.id_sender as any).firstName,
          lastName: (newMessage.id_sender as any).lastName,
          email: (newMessage.id_sender as any).email,
          profileImage: (newMessage.id_sender as any).profileImage
        },
        id_reciver: {
          id: (newMessage.id_reciver as any).id,
          firstName: (newMessage.id_reciver as any).firstName,
          lastName: (newMessage.id_reciver as any).lastName,
          email: (newMessage.id_reciver as any).email,
          profileImage: (newMessage.id_reciver as any).profileImage
        },
        read: newMessage.read,
        createdAt: newMessage.createdAt,
        updatedAt: newMessage.updatedAt
      }
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

    // Mark messages as read
    await MessageModel.updateMany(
      { id_Chat: chatId, id_reciver: userId, read: false },
      { read: true }
    );

    return res.json({
      ok: true,
      messages: messages.map(msg => ({
        id: msg.id,
        id_Chat: msg.id_Chat.toString(),
        message: msg.message,
        id_sender: {
          id: (msg.id_sender as any).id,
          firstName: (msg.id_sender as any).firstName,
          lastName: (msg.id_sender as any).lastName,
          email: (msg.id_sender as any).email,
          profileImage: (msg.id_sender as any).profileImage
        },
        id_reciver: {
          id: (msg.id_reciver as any).id,
          firstName: (msg.id_reciver as any).firstName,
          lastName: (msg.id_reciver as any).lastName,
          email: (msg.id_reciver as any).email,
          profileImage: (msg.id_reciver as any).profileImage
        },
        read: msg.read,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt
      }))
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

    // Mark messages as read
    await MessageModel.updateMany(
      { id_Chat: chatId, id_reciver: userId, read: false },
      { read: true }
    );

    return res.json({ ok: true, message: "Messages marqués comme lus" });
  } catch (error: any) {
    console.error("Error marking messages as read:", error);
    return res.status(500).json({ ok: false, message: "Erreur serveur", error: error.message });
  }
});

export default router;
