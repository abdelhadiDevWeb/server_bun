// Initialize Sentry first before any other imports
import "dotenv/config";
import { initializeSentryAsync, Sentry } from "./config/sentry";
await initializeSentryAsync();

import helmet from "helmet";
import morgan from "morgan";
// @ts-ignore - Express types issue with ESNext modules
import express from "express";
import rateLimit from "express-rate-limit";
import { logger, correlationMiddleware, requestLoggingMiddleware, errorLoggingMiddleware } from "./utils/logger";
import {
  requestAccessFileLogMiddleware,
  getAccessLogPathForDiagnostics,
} from "./utils/requestAccessFileLog";
import { connectDatabase } from "./Database/Mongoose";
import { AppConfig, ValidatAppConfig } from "./config/app.config";
import Allversion from "./Router/index";
import crypto from 'crypto'
import  {type Request , type Response , type NextFunction}  from 'express'
import cookieParser from 'cookie-parser'
import http from "http";
import cors, { type CorsOptions } from "cors";
import path from 'path'
import { Server as SocketIOServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { connectRedis, redisPubClient, redisSubClient, disconnectRedis } from "./config/redis";
import { EventCoalescingManager } from "./utils/messageIdempotency";
 



// import session from "express-session";
// import { SessionEntity } from "./entity/Session";


const app = express();
const server = http.createServer(app);

// Sentry (v10): request/tracing handlers are provided by integrations.
// We keep only the error handler via setupExpressErrorHandler(app) further below.

// If you're running behind a proxy (ngrok / load balancer), Express must trust it
// so req.ip and X-Forwarded-For are handled correctly (needed by express-rate-limit).
app.set("trust proxy", 1);

// Initialize Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin:"https://carsure-dz.vercel.app",
    // origin: process.env.NODE_ENV !== 'production' ? true : ["http://localhost:3000", "http://localhost:5173"],
    credentials: true,
    methods: ["GET", "POST"]
  },
  // Connection management for scaling
  transports: ['websocket', 'polling'],
  allowEIO3: true,
});

// Set up Redis adapter for horizontal scaling (will be configured after Redis connects)
let redisAdapterConfigured = false;

// Make io available globally for routes
(global as any).io = io;

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join workshop room when authenticated
  socket.on('join_workshop', (workshopId: string) => {
    socket.join(`workshop_${workshopId}`);
    console.log(`Socket ${socket.id} joined workshop_${workshopId}`);
  });

  // Leave workshop room
  socket.on('leave_workshop', (workshopId: string) => {
    socket.leave(`workshop_${workshopId}`);
    console.log(`Socket ${socket.id} left workshop_${workshopId}`);
  });

  // Join user room when authenticated
  socket.on('join_user', (userId: string) => {
    socket.join(`user_${userId}`);
    console.log(`Socket ${socket.id} joined user_${userId}`);
  });

  // Leave user room
  socket.on('leave_user', (userId: string) => {
    socket.leave(`user_${userId}`);
    console.log(`Socket ${socket.id} left user_${userId}`);
  });

  // Join admin room when authenticated
  socket.on('join_admin', (adminId: string) => {
    socket.join(`admin_${adminId}`);
    // Global admins room (for broadcasting events to all admins)
    socket.join('admins');
    console.log(`Socket ${socket.id} joined admin_${adminId}`);
  });

  // Leave admin room
  socket.on('leave_admin', (adminId: string) => {
    socket.leave(`admin_${adminId}`);
    socket.leave('admins');
    console.log(`Socket ${socket.id} left admin_${adminId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});


// CORS configuration - Allow all origins in development for mobile apps
// In production, restrict to specific domains
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://carsure-dz.vercel.app",
];

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // السماح لـ Postman / mobile apps / curl
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("❌ Blocked CORS origin:", origin);

    return callback(new Error("CORS not allowed for: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
// app.use(express.static('uploads/images'));
// app.use(express.static("uploads/pdf"));
// app.use(express.static("uploads/video"));
app.use('/uploads/images', express.static(path.join(__dirname, 'uploads/images')));
app.use('/uploads/pdf', express.static(path.join(__dirname, 'uploads/pdf')));
app.use('/uploads/video', express.static(path.join(__dirname, 'uploads/video')));
app.use('/uploads/users_images', express.static(path.join(__dirname, 'uploads/users_images')));
app.use('/uploads/rdv_images', express.static(path.join(__dirname, 'uploads/rdv_images')));
app.use('/uploads/rdv_pdf', express.static(path.join(__dirname, 'uploads/rdv_pdf')));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({extended:true , limit:'100mb'}))
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// app.get('/test' , (req:Request , res:Response)=>{


//   const newPar = new UAParser(req.headers["user-agent"]);
//   const result = newPar.getResult()
//   logInfo.info({
//     ip : req.ip ,
//     browser : result.browser.name ,
//     device : result.os.name , 
//     date : `${new Date().getHours()}:${new Date().getMinutes() < 10 ?`0${new Date().getMinutes()}`:new Date().getMinutes() }`
//   })
// })





app.use((req: Request, res: Response, next: NextFunction) => {
   res.locals.cspNonce = crypto.randomBytes(16).toString('base64')
   next()
})

// Structured logging middleware
app.use(correlationMiddleware);
app.use(requestAccessFileLogMiddleware);
app.use(requestLoggingMiddleware);

// Enhanced Helmet configuration for better security
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'strict-dynamic'",
          (req, res) =>
            `'nonce-${(res as Response & { locals: any }).locals.cspNonce}'`,
          "https:",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https:"],
        imgSrc: ["'self'", "data:", "https:"],
        // In development allow http(s) connections (fetch, websockets) to local backends/frontends
        // In production restrict to https and same-origin
        connectSrc:
          process.env.NODE_ENV !== "production"
            ? ["'self'", "http:", "https:"]
            : ["'self'", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Set to true if you don't need to embed resources
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    dnsPrefetchControl: true,
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: false,
    referrerPolicy: { policy: "no-referrer" },
    xssFilter: true,
  })
);

// General rate limiting
import { generalRateLimiter } from "./middleware/rateLimit.middleware";
app.use(generalRateLimiter);



app.use('/api' , Allversion)

// Error logging middleware (before Sentry handler)
app.use(errorLoggingMiddleware);

// Sentry error handler must be after all routes but before other error handlers
Sentry?.setupExpressErrorHandler?.(app);

// Health check endpoint
app.get('/api/health', async (_req: Request, res: Response) => {
  const { checkRedisHealth } = await import('./config/redis');
  
  const health = {
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      redis: await checkRedisHealth(),
      socketAdapter: redisAdapterConfigured,
    }
  };
  
  // Return 503 if Redis is down in production
  if (process.env.NODE_ENV === 'production' && !health.services.redis) {
    health.ok = false;
    health.status = 'degraded';
    return res.status(503).json(health);
  }
  
  res.status(200).json(health);
});

// Cache warming endpoint (for deployments)
app.post('/api/cache/warmup', async (_req: Request, res: Response) => {
  try {
    const { CachingService } = await import('./services/cachingService');
    await CachingService.warmUpCaches();
    
    logger.info({
      msg: 'Cache warm-up requested via API',
    });
    
    res.status(200).json({ 
      ok: true, 
      message: 'Cache warm-up completed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({
      error,
      msg: 'Cache warm-up failed',
    });
    
    res.status(500).json({
      ok: false,
      message: 'Cache warm-up failed',
    });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const { MetricsService } = await import('./services/metricsService');
    const metrics = await MetricsService.exportPrometheusMetrics();
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(metrics);
  } catch (error) {
    logger.error({
      error,
      msg: 'Error generating Prometheus metrics',
    });
    
    res.status(500).send('# Error generating metrics\n');
  }
});

// Application metrics endpoint (JSON format)
app.get('/api/metrics', async (_req: Request, res: Response) => {
  try {
    const { MetricsService } = await import('./services/metricsService');
    const metrics = await MetricsService.collectMetrics();
    
    res.status(200).json({
      ok: true,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({
      error,
      msg: 'Error collecting application metrics',
    });
    
    res.status(500).json({
      ok: false,
      message: 'Error collecting metrics',
    });
  }
});

// Metrics summary for admin dashboard
app.get('/api/admin/metrics-summary', async (req: Request, res: Response) => {
  try {
    // Simple auth check - in production you'd use proper middleware
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        message: 'Authorization required',
      });
    }

    const { MetricsService } = await import('./services/metricsService');
    const summary = await MetricsService.getMetricsSummary();
    
    res.status(200).json({
      ok: true,
      ...summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({
      error,
      msg: 'Error getting metrics summary',
    });
    
    res.status(500).json({
      ok: false,
      message: 'Error getting metrics summary',
    });
  }
});

ValidatAppConfig(async () => {
  try {
    // Connect to MongoDB
    await connectDatabase();

    // Connect to Redis for caching and Socket.IO adapter
    try {
      await connectRedis();
      
      // Configure Socket.IO Redis adapter for horizontal scaling
      if (redisPubClient.isOpen && redisSubClient.isOpen) {
        const redisAdapter = createAdapter(redisPubClient, redisSubClient);
        io.adapter(redisAdapter);
        redisAdapterConfigured = true;
        
        logger.info({
          msg: 'Socket.IO Redis adapter configured for horizontal scaling',
        });
      }
    } catch (redisError) {
      logger.warn({
        error: redisError,
        msg: 'Redis connection failed, continuing without Redis features',
      });
      
      // In production, you might want to fail here
      if (process.env.NODE_ENV === 'production') {
        logger.error({
          msg: 'Redis is required in production for scaling',
        });
      }
    }

    // Run Server
    // Listen on all network interfaces (0.0.0.0) to allow connections from mobile devices
    // Use 'localhost' or '127.0.0.1' if you only want local connections
    server.listen(AppConfig.PORT, '0.0.0.0', () => {
      const accessLog = getAccessLogPathForDiagnostics();
      logger.info({
        port: AppConfig.PORT,
        host: '0.0.0.0',
        localUrl: `http://localhost:${AppConfig.PORT}`,
        redisAdapter: redisAdapterConfigured,
        requestAccessLog: accessLog.enabled ? accessLog.file : 'disabled',
        msg: 'Server started successfully',
      });
    });
  } catch (err: unknown) {
    logger.fatal({
      error: err,
      msg: 'Failed to start server',
    });
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Unknown error occurred');
  }
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info({ msg: 'SIGTERM received, starting graceful shutdown' });
  
  try {
    // Flush any pending coalesced events
    EventCoalescingManager.flushAll(io);
    
    // Disconnect from Redis
    await disconnectRedis();
    
    // Close the server
    server.close(() => {
      logger.info({ msg: 'Server closed gracefully' });
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error({ msg: 'Forced shutdown after 10 seconds' });
      process.exit(1);
    }, 10000);
  } catch (error) {
    logger.error({ error, msg: 'Error during graceful shutdown' });
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info({ msg: 'SIGINT received, starting graceful shutdown' });
  
  try {
    // Flush any pending coalesced events
    EventCoalescingManager.flushAll(io);
    
    // Disconnect from Redis
    await disconnectRedis();
    
    // Close the server
    server.close(() => {
      logger.info({ msg: 'Server closed gracefully' });
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error, msg: 'Error during graceful shutdown' });
    process.exit(1);
  }
});
