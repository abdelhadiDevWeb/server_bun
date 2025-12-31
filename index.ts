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
 



// import session from "express-session";
// import { SessionEntity } from "./entity/Session";


const app = express();
const server = http.createServer(app);


const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  credentials: true,
};


app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.static('uploads/images'));
app.use(express.static("uploads/pdf"));
app.use(express.static("uploads/video"));
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
app.use(helmet.hidePoweredBy());
app.use(helmet.ieNoOpen());
app.use(helmet.hsts());



app.use(
  helmet.contentSecurityPolicy({
    directives: {
      default: ["'self'"],
      scriptSrc: [
        "'self'",
        "'strict-dynamic'",
        (req, res) =>
          `'nonce-${(res as Response & { locals: any }).locals.cspNonce}'`,
        "https:",
      ],
    },
  })
);




app.use(
  rateLimit({
    limit: 80,
    windowMs: 60 * 1000,
    message: "Is To mush",
    legacyHeaders: false,
    standardHeaders: false,
  })
);



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
