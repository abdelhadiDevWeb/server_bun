import { Router } from "express";
import type { Request, Response } from "express";
import authRouter from "./auth";
import carRouter from "./car";
import userImageRouter from "./userImage";
import userRouter from "./user";
import statsRouter from "./stats";
import workshopRouter from "./workshop";
import rdvWorkshopRouter from "./rdvWorkshop";
import notificationRouter from "./notification";
import sellerStatsRouter from "./sellerStats";
import workshopStatsRouter from "./workshopStats";
import adminRouter from "./admin";
import abonnementRouter from "./abonnement";
import chatRouter from "./chat";
import factureRouter from "./facture";
import rateRouter from "./rate";
import sponsorRouter from "./sponsor";
import geocodeRouter from "./geocode";

const router = Router();

// Health check endpoint
router.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

router.use("/auth", authRouter);
router.use("/car", carRouter);
router.use("/user-image", userImageRouter);
router.use("/user", userRouter);
router.use("/stats", statsRouter);
router.use("/workshop", workshopRouter);
router.use("/rdv-workshop", rdvWorkshopRouter);
router.use("/notification", notificationRouter);
router.use("/seller-stats", sellerStatsRouter);
router.use("/workshop-stats", workshopStatsRouter);
router.use("/admin", adminRouter);
router.use("/abonnement", abonnementRouter);
router.use("/chat", chatRouter);
router.use("/facture", factureRouter);
router.use("/rate", rateRouter);
router.use("/sponsor", sponsorRouter);
router.use("/geocode", geocodeRouter);
// media mounted in index.ts before rate limiter (avoids 429 on image resize)

export default router;

