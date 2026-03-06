import mongoose from "mongoose";
import "dotenv/config";

const MONGODB_URI = process.env.MONGODB_URI ;

export const connectDatabase = async (): Promise<void> => {
  try {
    if(MONGODB_URI) {
      await mongoose.connect(MONGODB_URI, {
      // MongoDB connection options
    });
    }
    console.log('MongoDB Database Cars application Is Connected' , MONGODB_URI);
  } catch (error) {
    console.error('MongoDB connection error:', error);
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

