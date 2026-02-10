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
    origin: ["http://localhost:3000", "http://localhost:5173"],
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

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});


const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  credentials: true,
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
    server.listen(AppConfig.PORT, () => {
      console.log("server is runing on port ", AppConfig.PORT);
    });
  } catch (err: unknown) {
    console.log('Error:', err);
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Unknown error occurred');
  }
});
