import helmet from "helmet";
import morgan from "morgan";
// @ts-ignore - Express types issue with ESNext modules
import express from "express";
import rateLimit from "express-rate-limit";
import { connectDatabase } from "./Database/Mongoose";
import "dotenv/config";
import { AppConfig, ValidatAppConfig } from "./config/app.config";
import Allversion from "./Router/index";
import crypto from 'crypto'
import  {type Request , type Response , type NextFunction}  from 'express'
import cookieParser from 'cookie-parser'
import http from "http";
import cors from 'cors'
import path from 'path'
import { Server as SocketIOServer } from 'socket.io'
 



// import session from "express-session";
// import { SessionEntity } from "./entity/Session";


const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV !== 'production' ? true : ["http://localhost:3000", "http://localhost:5173"],
    credentials: true,
    methods: ["GET", "POST"]
  }
});

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
    console.log(`Socket ${socket.id} joined admin_${adminId}`);
  });

  // Leave admin room
  socket.on('leave_admin', (adminId: string) => {
    socket.leave(`admin_${adminId}`);
    console.log(`Socket ${socket.id} left admin_${adminId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});


// CORS configuration - Allow all origins in development for mobile apps
// In production, restrict to specific domains
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow localhost origins (web development)
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
    ];
    
    // Allow any origin in development (for mobile apps)
    // Mobile apps don't have a traditional origin, so we allow all in dev
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // In production, only allow specific origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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


app.use(morgan("dev"));

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
        connectSrc: ["'self'", "https:"],
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


ValidatAppConfig(async () => {
  try {
    // Connect to MongoDB
    await connectDatabase();

    // Run Server
    // Listen on all network interfaces (0.0.0.0) to allow connections from mobile devices
    // Use 'localhost' or '127.0.0.1' if you only want local connections
    server.listen(AppConfig.PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${AppConfig.PORT}`);
      console.log(`Accessible at: http://localhost:${AppConfig.PORT}`);
      console.log(`For mobile devices, use your local IP address: http://YOUR_LOCAL_IP:${AppConfig.PORT}`);
    });
  } catch (err: unknown) {
    console.log('Error:', err);
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Unknown error occurred');
  }
});
