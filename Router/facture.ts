import { Router } from "express";
import type { Request, Response } from "express";
import { Facture } from "../Models/Facture";
import { authenticateToken } from "../middleware/auth.middleware";
import { requireWorkshop } from "../middleware/auth.middleware";
import mongoose from "mongoose";

const router = Router();

// Get all factures for a workshop (workshop only)
router.get("/", authenticateToken, requireWorkshop, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.type;

    if (!userId || userType !== 'workshop') {
      return res.status(401).json({
        ok: false,
        message: "Atelier non authentifié",
      });
    }

    const factures = await Facture.find({ id_workshop: userId })
      .populate('id_user', 'firstName lastName email phone')
      .sort({ date: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      ok: true,
      factures: factures.map(facture => ({
        ...facture,
        id: facture._id?.toString(),
      })),
    });
  } catch (err: any) {
    console.error("Get factures error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Create a new facture (workshop only)
router.post("/", authenticateToken, requireWorkshop, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.type;

    if (!userId || userType !== 'workshop') {
      return res.status(401).json({
        ok: false,
        message: "Atelier non authentifié",
      });
    }

    const { id_user, service, total } = req.body;

    if (!id_user || !service || total === undefined || total === null) {
      return res.status(400).json({
        ok: false,
        message: "Tous les champs sont requis (id_user, service, total)",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id_user)) {
      return res.status(400).json({
        ok: false,
        message: "ID utilisateur invalide",
      });
    }

    if (!['mécanique', 'vérification peinture', 'mécanique & peinture'].includes(service)) {
      return res.status(400).json({
        ok: false,
        message: "Service invalide. Doit être 'mécanique', 'vérification peinture', ou 'mécanique & peinture'",
      });
    }

    if (typeof total !== 'number' || total < 0) {
      return res.status(400).json({
        ok: false,
        message: "Le total doit être un nombre positif",
      });
    }

    const facture = new Facture({
      id_workshop: userId,
      id_user,
      service,
      total,
      date: new Date(),
    });

    await facture.save();

    const populatedFacture = await Facture.findById(facture._id)
      .populate('id_user', 'firstName lastName email phone')
      .lean();

    return res.status(201).json({
      ok: true,
      message: "Facture créée avec succès",
      facture: {
        ...populatedFacture,
        id: populatedFacture?._id?.toString(),
      },
    });
  } catch (err: any) {
    console.error("Create facture error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
