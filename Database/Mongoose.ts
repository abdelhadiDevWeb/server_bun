import mongoose from "mongoose";
import "dotenv/config";

const MONGODB_URI = process.env.MONGODB_URI;

export const connectDatabase = async (): Promise<void> => {
  try {
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is missing. Please set it in server_bun/.env");
    }
    await mongoose.connect(MONGODB_URI, {
      // MongoDB connection options
    });
    console.log('✅ MongoDB Database connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    console.log('MongoDB Database Disconnected');
  } catch (error) {
    console.error('MongoDB disconnection error:', error);
    throw error;
  }
};

export default mongoose;

