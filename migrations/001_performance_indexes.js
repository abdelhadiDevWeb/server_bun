/**
 * Database Performance Indexes Migration
 * 
 * Run this migration to add critical indexes for 100K+ user scalability
 * 
 * Usage:
 * - MongoDB: Run with `mongosh < 001_performance_indexes.js`
 * - Production: Apply during maintenance window
 */

// Connect to your database
// const db = connect('mongodb://localhost:27017/carsure_db');

// Critical performance indexes for high-traffic scenarios
const indexes = [
  // 1. NOTIFICATIONS - Most frequently queried
  {
    collection: 'notifications',
    indexes: [
      // Primary query: user notifications by read status and date
      { 
        key: { userId: 1, is_read: 1, createdAt: -1 }, 
        name: 'idx_notifications_user_read_date',
        background: true 
      },
      
      // Type-based filtering (e.g., only message notifications)
      { 
        key: { userId: 1, type: 1, createdAt: -1 }, 
        name: 'idx_notifications_user_type_date',
        background: true 
      },
      
      // Cleanup queries (delete old notifications)
      { 
        key: { createdAt: -1 }, 
        name: 'idx_notifications_created',
        background: true 
      },
      
      // Sender-based queries for chat notifications
      { 
        key: { userId: 1, id_sender: 1, is_read: 1 }, 
        name: 'idx_notifications_user_sender_read',
        background: true 
      }
    ]
  },

  // 2. CHATS - Real-time messaging performance
  {
    collection: 'chats',
    indexes: [
      // User's chat list ordered by last activity
      { 
        key: { participants: 1, updatedAt: -1 }, 
        name: 'idx_chats_participants_updated',
        background: true 
      },
      
      // Individual user chats
      { 
        key: { 'participant1.id': 1, updatedAt: -1 }, 
        name: 'idx_chats_user1_updated',
        background: true 
      },
      { 
        key: { 'participant2.id': 1, updatedAt: -1 }, 
        name: 'idx_chats_user2_updated',
        background: true 
      },
      
      // Chat lookup by participants (avoid duplicates)
      { 
        key: { participants: 1 }, 
        name: 'idx_chats_participants',
        unique: true,
        background: true 
      }
    ]
  },

  // 3. MESSAGES - Chat message performance
  {
    collection: 'messages',
    indexes: [
      // Messages in a chat (pagination)
      { 
        key: { id_Chat: 1, createdAt: -1 }, 
        name: 'idx_messages_chat_date',
        background: true 
      },
      
      // Unread message count per user
      { 
        key: { id_Chat: 1, id_user: 1, is_read: 1 }, 
        name: 'idx_messages_chat_user_read',
        background: true 
      },
      
      // Sender's message history
      { 
        key: { id_user: 1, createdAt: -1 }, 
        name: 'idx_messages_sender_date',
        background: true 
      },
      
      // Cleanup old messages
      { 
        key: { createdAt: -1 }, 
        name: 'idx_messages_created',
        background: true 
      }
    ]
  },

  // 4. CARS - Vehicle listings performance
  {
    collection: 'cars',
    indexes: [
      // Owner's cars with status filtering
      { 
        key: { owner_id: 1, status: 1, createdAt: -1 }, 
        name: 'idx_cars_owner_status_date',
        background: true 
      },
      
      // Public car search and filtering
      { 
        key: { status: 1, is_certified: 1, city: 1, price: 1 }, 
        name: 'idx_cars_public_search',
        background: true 
      },
      
      // Brand and model filtering
      { 
        key: { status: 1, brand: 1, model: 1, year: -1 }, 
        name: 'idx_cars_brand_model',
        background: true 
      },
      
      // Price range queries
      { 
        key: { status: 1, price: 1, createdAt: -1 }, 
        name: 'idx_cars_price_range',
        background: true 
      },
      
      // Location-based search
      { 
        key: { status: 1, city: 1, createdAt: -1 }, 
        name: 'idx_cars_location',
        background: true 
      },
      
      // Full-text search on title and description
      { 
        key: { title: 'text', description: 'text' }, 
        name: 'idx_cars_text_search',
        background: true 
      },

      // Featured/promoted cars
      { 
        key: { status: 1, is_featured: 1, createdAt: -1 }, 
        name: 'idx_cars_featured',
        background: true 
      }
    ]
  },

  // 5. APPOINTMENTS - Workshop scheduling performance
  {
    collection: 'appointments',
    indexes: [
      // Workshop's appointments by status and date
      { 
        key: { workshopId: 1, status: 1, appointmentDate: 1 }, 
        name: 'idx_appointments_workshop_status_date',
        background: true 
      },
      
      // User's appointments
      { 
        key: { userId: 1, status: 1, appointmentDate: -1 }, 
        name: 'idx_appointments_user_status_date',
        background: true 
      },
      
      // Today's appointments for workshop dashboard
      { 
        key: { workshopId: 1, appointmentDate: 1, status: 1 }, 
        name: 'idx_appointments_today',
        background: true 
      },
      
      // Appointment history and analytics
      { 
        key: { workshopId: 1, createdAt: -1 }, 
        name: 'idx_appointments_history',
        background: true 
      },
      
      // Car-specific appointments
      { 
        key: { carId: 1, createdAt: -1 }, 
        name: 'idx_appointments_car',
        background: true 
      }
    ]
  },

  // 6. USERS - Authentication and profile performance
  {
    collection: 'users',
    indexes: [
      // Login performance
      { 
        key: { email: 1 }, 
        name: 'idx_users_email',
        unique: true,
        background: true 
      },
      
      // Phone-based lookup
      { 
        key: { phone: 1 }, 
        name: 'idx_users_phone',
        sparse: true,
        background: true 
      },
      
      // User type filtering
      { 
        key: { userType: 1, is_active: 1 }, 
        name: 'idx_users_type_active',
        background: true 
      },
      
      // City-based user search
      { 
        key: { city: 1, userType: 1 }, 
        name: 'idx_users_city_type',
        background: true 
      }
    ]
  },

  // 7. WORKSHOPS - Workshop directory performance
  {
    collection: 'workshops',
    indexes: [
      // Public workshop search
      { 
        key: { is_active: 1, is_certified: 1, city: 1 }, 
        name: 'idx_workshops_public',
        background: true 
      },
      
      // Workshop type filtering
      { 
        key: { is_active: 1, workshop_type: 1, city: 1 }, 
        name: 'idx_workshops_type_city',
        background: true 
      },
      
      // Rating-based sorting
      { 
        key: { is_active: 1, rating: -1 }, 
        name: 'idx_workshops_rating',
        background: true 
      },
      
      // Owner lookup
      { 
        key: { owner_id: 1 }, 
        name: 'idx_workshops_owner',
        unique: true,
        background: true 
      }
    ]
  },

  // 8. FILES - Image and document performance
  {
    collection: 'files',
    indexes: [
      // Entity-based file lookup (cars, users, appointments)
      { 
        key: { entityType: 1, entityId: 1, fileType: 1 }, 
        name: 'idx_files_entity',
        background: true 
      },
      
      // Owner-based file management
      { 
        key: { ownerId: 1, createdAt: -1 }, 
        name: 'idx_files_owner',
        background: true 
      },
      
      // Cleanup expired temporary files
      { 
        key: { isTemporary: 1, expiresAt: 1 }, 
        name: 'idx_files_cleanup',
        background: true 
      }
    ]
  },

  // 9. SESSIONS - Authentication session management
  {
    collection: 'sessions',
    indexes: [
      // Session lookup by token
      { 
        key: { sessionToken: 1 }, 
        name: 'idx_sessions_token',
        unique: true,
        background: true 
      },
      
      // User sessions
      { 
        key: { userId: 1, expiresAt: -1 }, 
        name: 'idx_sessions_user',
        background: true 
      },
      
      // TTL index for automatic session cleanup
      { 
        key: { expiresAt: 1 }, 
        name: 'idx_sessions_ttl',
        expireAfterSeconds: 0,
        background: true 
      }
    ]
  },

  // 10. ANALYTICS - Performance tracking
  {
    collection: 'analytics',
    indexes: [
      // Event tracking by type and date
      { 
        key: { eventType: 1, createdAt: -1 }, 
        name: 'idx_analytics_event_date',
        background: true 
      },
      
      // User behavior analytics
      { 
        key: { userId: 1, eventType: 1, createdAt: -1 }, 
        name: 'idx_analytics_user_behavior',
        background: true 
      },
      
      // Performance metrics
      { 
        key: { route: 1, createdAt: -1 }, 
        name: 'idx_analytics_performance',
        background: true 
      }
    ]
  }
];

// Function to create all indexes
async function createPerformanceIndexes() {
  console.log('Starting performance indexes migration...');
  
  for (const collectionConfig of indexes) {
    const { collection, indexes: collectionIndexes } = collectionConfig;
    
    console.log(`Creating indexes for ${collection}...`);
    
    try {
      for (const indexConfig of collectionIndexes) {
        const { key, name, ...options } = indexConfig;
        
        console.log(`  - Creating index: ${name}`);
        
        // Create index with error handling
        try {
          await db.collection(collection).createIndex(key, { name, ...options });
          console.log(`    ✓ Index ${name} created successfully`);
        } catch (error) {
          if (error.code === 85) { // Index already exists
            console.log(`    - Index ${name} already exists, skipping`);
          } else {
            console.error(`    ✗ Error creating index ${name}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing collection ${collection}:`, error.message);
    }
  }
  
  console.log('Performance indexes migration completed!');
}

// Function to analyze query performance
async function analyzeQueryPerformance() {
  console.log('Analyzing query performance...');
  
  const collections = ['notifications', 'chats', 'messages', 'cars', 'appointments'];
  
  for (const collection of collections) {
    console.log(`\n=== ${collection.toUpperCase()} COLLECTION ===`);
    
    // Get collection stats
    const stats = await db.collection(collection).stats();
    console.log(`Documents: ${stats.count.toLocaleString()}`);
    console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Indexes: ${stats.nindexes}`);
    
    // List indexes
    const indexes = await db.collection(collection).getIndexes();
    console.log('Indexes:');
    indexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
  }
}

// Export functions for use in migration scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createPerformanceIndexes,
    analyzeQueryPerformance,
    indexes
  };
}

// Auto-run if executed directly
if (typeof db !== 'undefined') {
  createPerformanceIndexes().catch(console.error);
}