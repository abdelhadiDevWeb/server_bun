import { Router } from "express";
import type { Request, Response } from "express";
import { Workshop } from "../Models/Workshop";
import { CachingService } from "../services/cachingService";
import { logger } from "../utils/logger";
import mongoose from "mongoose";

const router = Router();

// Get all active workshops (public endpoint).
// Only returns workshops with status=true. Cached via CachingService.
// Used by features that should only surface bookable workshops (e.g. the RDV
// creation modal in the cars page).
router.get("/active", async (req: Request, res: Response) => {
  try {
    const skipCache = req.query.fresh === '1';

    if (skipCache) {
      await CachingService.invalidateActiveWorkshops();
    }

    const result = await CachingService.getActiveWorkshops();
    
    logger.info({
      fromCache: result.fromCache,
      workshopCount: result.workshops.length,
      msg: 'Active workshops query served',
    });

    return res.status(200).json({
      ok: true,
      workshops: result.workshops,
      fromCache: result.fromCache,
    });
  } catch (err: any) {
    logger.error({
      error: err,
      msg: "Get active workshops error",
    });
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get every workshop in the database (public endpoint).
// No status filter, no Redis cache — used by the workshops listing page so the
// user always sees the freshest, complete view of the table (including
// pending / not-yet-activated workshops). The mobile UI then filters client-
// side via the "all / certified / not_certified" tabs.
router.get("/all", async (_req: Request, res: Response) => {
  try {
    const workshops = await Workshop.find()
      .select('-password')
      .sort({ certifie: -1, name: 1 })
      .lean();

    return res.status(200).json({
      ok: true,
      workshops: workshops.map((w: any) => ({
        ...w,
        id: w._id?.toString(),
      })),
    });
  } catch (err: any) {
    logger.error({
      error: err,
      msg: "Get all workshops error",
    });
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get workshop by ID (public endpoint)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID atelier invalide",
      });
    }

    const workshop = await Workshop.findById(id)
      .select('-password')
      .lean();

    if (!workshop) {
      return res.status(404).json({
        ok: false,
        message: "Atelier non trouvé",
      });
    }

    return res.status(200).json({
      ok: true,
      workshop: {
        ...workshop,
        id: workshop._id?.toString(),
      },
    });
  } catch (err: any) {
    console.error("Get workshop by ID error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
