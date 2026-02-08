import { Router } from "express";
import type { Request, Response } from "express";
import { Workshop } from "../Models/Workshop";

const router = Router();

// Get all active workshops (public endpoint)
router.get("/active", async (req: Request, res: Response) => {
  try {
    const workshops = await Workshop.find({ status: true })
      .select('-password')
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      ok: true,
      workshops: workshops.map(workshop => ({
        ...workshop,
        id: workshop._id?.toString(),
      })),
    });
  } catch (err: any) {
    console.error("Get active workshops error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
