import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { User } from '../Models/User';
import { Workshop } from '../Models/Workshop';
import mongoose from 'mongoose';

// Create an Expo SDK client
const expo = new Expo();

/**
 * Send push notification to a user
 * @param userId - User ID (can be User or Workshop)
 * @param title - Notification title
 * @param body - Notification body/message
 * @param data - Additional data to send with notification
 * @returns Promise<boolean> - true if sent successfully
 */
export const sendPushNotification = async (
  userId: string | mongoose.Types.ObjectId,
  title: string,
  body: string,
  data?: any
): Promise<boolean> => {
  try {
    // Convert userId to ObjectId if needed
    const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;

    // Try to find user first
    let user = await User.findById(userIdObjectId).select('pushToken platform deviceId').lean();
    let userType = 'user';

    // If not found, try workshop
    if (!user) {
      const workshop = await Workshop.findById(userIdObjectId).select('pushToken platform deviceId').lean();
      if (workshop) {
        user = workshop as any;
        userType = 'workshop';
      }
    }

    // If user not found or no push token, return false
    if (!user || !(user as any).pushToken) {
      console.log(`⚠️  No push token found for ${userType} ${userIdObjectId}`);
      return false;
    }

    const pushToken = (user as any).pushToken;

    // Check if token is valid Expo push token
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`❌ Invalid Expo push token for ${userType} ${userIdObjectId}: ${pushToken}`);
      return false;
    }

    // Create the message
    const message: ExpoPushMessage = {
      to: pushToken,
      sound: 'default',
      title: title,
      body: body,
      data: {
        ...data,
        userId: userIdObjectId.toString(),
        userType: userType,
      },
      priority: 'high', // Important for background notifications
      channelId: 'default', // For Android
    };

    // Send the notification
    const chunks = expo.chunkPushNotifications([message]);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('❌ Error sending push notification chunk:', error);
        return false;
      }
    }

    // Check for errors in tickets
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        console.error(`❌ Push notification error: ${ticket.message}`);
        if (ticket.details?.error === 'DeviceNotRegistered') {
          // Token is no longer valid, remove it from database
          console.log(`🗑️  Removing invalid push token for ${userType} ${userIdObjectId}`);
          if (userType === 'user') {
            await User.findByIdAndUpdate(userIdObjectId, {
              pushToken: null,
              platform: null,
              deviceId: null,
            });
          } else {
            await Workshop.findByIdAndUpdate(userIdObjectId, {
              pushToken: null,
              platform: null,
              deviceId: null,
            });
          }
        }
        return false;
      }
    }

    console.log(`✅ Push notification sent successfully to ${userType} ${userIdObjectId}`);
    return true;
  } catch (error: any) {
    console.error('❌ Error in sendPushNotification:', error);
    return false;
  }
};

/**
 * Send push notification to multiple users
 * @param userIds - Array of user IDs
 * @param title - Notification title
 * @param body - Notification body/message
 * @param data - Additional data to send with notification
 * @returns Promise<number> - Number of successful sends
 */
export const sendPushNotificationToMultiple = async (
  userIds: (string | mongoose.Types.ObjectId)[],
  title: string,
  body: string,
  data?: any
): Promise<number> => {
  let successCount = 0;
  
  for (const userId of userIds) {
    const success = await sendPushNotification(userId, title, body, data);
    if (success) {
      successCount++;
    }
  }

  return successCount;
};
