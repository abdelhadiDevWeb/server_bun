#!/usr/bin/env node

import mongoose from "mongoose";
import { connectDatabase } from "../Database/Mongoose";
import "dotenv/config";

// Import all models to ensure they are registered
import { Car } from "../Models/Car";
import { Notification } from "../Models/Notification";
import { MessageModel } from "../Models/Message";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { Chat } from "../Models/Chat";

interface IndexDefinition {
  collection: string;
  index: any;
  options?: any;
  description: string;
}

// Define all compound indexes needed for optimal performance
const indexes: IndexDefinition[] = [
  // Car model indexes - optimized for search and filtering
  {
    collection: "cars",
    index: { status: 1, createdAt: -1 },
    options: { background: true },
    description: "Public car search with status filter and date ordering"
  },
  {
    collection: "cars",
    index: { owner: 1, createdAt: -1 },
    options: { background: true },
    description: "User's cars with date ordering"
  },
  {
    collection: "cars",
    index: { brand: 1, model: 1, status: 1 },
    options: { background: true },
    description: "Brand and model search with status filter"
  },
  {
    collection: "cars",
    index: { price: 1, status: 1, createdAt: -1 },
    options: { background: true },
    description: "Price range filtering with status and date"
  },
  {
    collection: "cars",
    index: { year: 1, km: 1, status: 1 },
    options: { background: true },
    description: "Year and mileage filtering with status"
  },
  {
    collection: "cars",
    index: { boite: 1, type_gaz: 1, status: 1 },
    options: { background: true, sparse: true },
    description: "Transmission and fuel type filtering"
  },
  {
    collection: "cars",
    index: { accident: 1, status: 1, createdAt: -1 },
    options: { background: true },
    description: "Accident filtering with status and date"
  },
  {
    collection: "cars",
    index: { vin: 1 },
    options: { background: true, unique: true, sparse: true },
    description: "VIN unique constraint for validation"
  },

  // Notification model indexes - optimized for user queries
  {
    collection: "notifications",
    index: { id_receiver: 1, is_read: 1, createdAt: -1 },
    options: { background: true },
    description: "User notifications with read status and date ordering"
  },
  {
    collection: "notifications",
    index: { id_receiver: 1, type: 1, is_read: 1, createdAt: -1 },
    options: { background: true },
    description: "Filtered notifications by type with read status"
  },
  {
    collection: "notifications",
    index: { id_sender: 1, createdAt: -1 },
    options: { background: true },
    description: "Notifications sent by user/workshop"
  },
  {
    collection: "notifications",
    index: { type: 1, is_read: 1, createdAt: -1 },
    options: { background: true },
    description: "Admin notifications by type"
  },

  // Message model indexes - enhance existing ones
  {
    collection: "messages",
    index: { id_sender: 1, id_reciver: 1, createdAt: -1 },
    options: { background: true },
    description: "Conversation messages between two users"
  },
  {
    collection: "messages",
    index: { id_reciver: 1, read: 1, createdAt: -1 },
    options: { background: true },
    description: "Unread messages with date ordering"
  },

  // RendezVousWorkshop model indexes - enhance existing ones
  {
    collection: "rendez-vous-workshops",
    index: { id_car: 1, status: 1, createdAt: -1 },
    options: { background: true },
    description: "Appointments for specific car with status"
  },
  {
    collection: "rendez-vous-workshops",
    index: { id_owner_car: 1, status: 1, createdAt: -1 },
    options: { background: true },
    description: "User's appointments with status and date"
  },
  {
    collection: "rendez-vous-workshops",
    index: { id_workshop: 1, status: 1, date: 1 },
    options: { background: true },
    description: "Workshop appointments with status and date"
  },
  {
    collection: "rendez-vous-workshops",
    index: { date: 1, time: 1, id_workshop: 1 },
    options: { background: true },
    description: "Time slot availability queries"
  },

  // User model indexes - for admin queries and authentication
  {
    collection: "users",
    index: { email: 1 },
    options: { background: true, unique: true },
    description: "User authentication by email"
  },
  {
    collection: "users",
    index: { role: 1, status: 1, createdAt: -1 },
    options: { background: true },
    description: "Admin user management queries"
  },
  {
    collection: "users",
    index: { type: 1, status: 1, createdAt: -1 },
    options: { background: true },
    description: "User type filtering (user/workshop)"
  },

  // Workshop model indexes
  {
    collection: "workshops",
    index: { email: 1 },
    options: { background: true, unique: true },
    description: "Workshop authentication by email"
  },
  {
    collection: "workshops",
    index: { status: 1, certifie: 1, createdAt: -1 },
    options: { background: true },
    description: "Active and certified workshops"
  },
  {
    collection: "workshops",
    index: { name: "text", adr: "text" },
    options: { background: true },
    description: "Workshop text search by name and address"
  },

  // Chat model indexes - for conversation management
  {
    collection: "chats",
    index: { users: 1, updatedAt: -1 },
    options: { background: true },
    description: "User conversations with last activity"
  }
];

async function createIndexes() {
  console.log("🚀 Starting database indexing process...");
  
  try {
    await connectDatabase();
    console.log("✅ Connected to database");
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const { collection, index, options = {}, description } of indexes) {
      try {
        console.log(`\n📊 Processing: ${collection}`);
        console.log(`   Index: ${JSON.stringify(index)}`);
        console.log(`   Description: ${description}`);
        
        const db = mongoose.connection.db;
        if (!db) {
          throw new Error("Database connection not available");
        }
        
        // Check if index already exists
        const existingIndexes = await db.collection(collection).indexes();
        const indexKey = JSON.stringify(index);
        
        const indexExists = existingIndexes.some((existing: any) => {
          const existingKey = JSON.stringify(existing.key);
          return existingKey === indexKey;
        });
        
        if (indexExists) {
          console.log(`   ⏭️  Index already exists, skipping`);
          skipCount++;
          continue;
        }
        
        // Create the index
        await db.collection(collection).createIndex(index, options);
        console.log(`   ✅ Index created successfully`);
        successCount++;
        
      } catch (error: any) {
        console.error(`   ❌ Error creating index: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log("\n🎉 Indexing process completed!");
    console.log(`   ✅ Created: ${successCount} indexes`);
    console.log(`   ⏭️  Skipped: ${skipCount} indexes (already exist)`);
    console.log(`   ❌ Errors: ${errorCount} indexes`);
    
    if (errorCount === 0) {
      console.log("\n🚀 All indexes processed successfully!");
      console.log("\n📈 Performance improvements expected for:");
      console.log("   • Car search and filtering queries");
      console.log("   • User notification retrieval");
      console.log("   • Message/chat operations");
      console.log("   • Appointment scheduling");
      console.log("   • Admin panel operations");
    }
    
  } catch (error: any) {
    console.error("💥 Fatal error during indexing:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Database connection closed");
  }
}

async function analyzeExistingIndexes() {
  console.log("🔍 Analyzing existing indexes...\n");
  
  try {
    await connectDatabase();
    
    const collections = ["cars", "notifications", "messages", "rendez-vous-workshops", "users", "workshops", "chats"];
    
    for (const collectionName of collections) {
      try {
        const db = mongoose.connection.db;
        if (!db) continue;
        
        const indexes = await db.collection(collectionName).indexes();
        console.log(`📊 ${collectionName}:`);
        
        indexes.forEach((index: any, i: number) => {
          const keyStr = JSON.stringify(index.key);
          const sizeInfo = index.indexSizes ? ` (${index.indexSizes})` : '';
          console.log(`   ${i + 1}. ${keyStr}${sizeInfo}`);
          
          if (index.unique) console.log(`      🔒 Unique constraint`);
          if (index.sparse) console.log(`      🕳️  Sparse index`);
          if (index.background) console.log(`      🔄 Built in background`);
        });
        
        console.log("");
      } catch (error) {
        console.log(`   ❌ Could not analyze ${collectionName}: ${error}`);
      }
    }
  } catch (error: any) {
    console.error("Error analyzing indexes:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

// Command line interface
const command = process.argv[2];

if (command === "analyze") {
  analyzeExistingIndexes();
} else if (command === "create" || !command) {
  createIndexes();
} else {
  console.log("Usage:");
  console.log("  npm run add-indexes         # Create new indexes");
  console.log("  npm run add-indexes analyze # Analyze existing indexes");
}