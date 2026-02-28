import { Router } from "express";
import type { Request, Response } from "express";
import { Workshop } from "../Models/Workshop";
import mongoose from "mongoose";

const router = Router();

// Get all active workshops (public endpoint)
// Only return workshops with status=true
router.get("/active", async (req: Request, res: Response) => {
  try {
    const workshops = await Workshop.find({ 
      status: true
    })
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
