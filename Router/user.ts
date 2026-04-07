import { Router } from "express";
import type { Request, Response } from "express";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

// Get all certified sellers (public endpoint)
// Only return users with role='client', certifie=true, status=true
router.get("/certified-sellers", async (req: Request, res: Response) => {
  try {
    const users = await User.find({ 
      role: 'client',
      certifie: true,
      status: true
    })
      .select('-password')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    return res.status(200).json({
      ok: true,
      users: users.map(user => ({
        ...user,
        id: user._id?.toString(),
      })),
    });
  } catch (err: any) {
    console.error("Get certified sellers error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Save push notification token
router.post("/push-token", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.type;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifié" });
    }

    const { pushToken, platform, deviceId } = req.body;

    if (!pushToken) {
      return res.status(400).json({ ok: false, message: "Token push requis" });
    }

    if (!platform || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ ok: false, message: "Plateforme invalide (ios ou android requis)" });
    }

    const update = {
      pushToken,
      platform,
      deviceId: deviceId || null,
      pushTokenUpdatedAt: new Date(),
    };

    // Save token for the authenticated principal (User or Workshop)
    if (userType === 'workshop') {
      const updated = await Workshop.findByIdAndUpdate(userId, update, { new: true }).select('_id').lean();
      if (!updated) {
        return res.status(404).json({ ok: false, message: "Atelier introuvable" });
      }
      console.log(`✅ Push token saved for workshop ${userId} (${platform})`);
    } else {
      const updated = await User.findByIdAndUpdate(userId, update, { new: true }).select('_id').lean();
      if (!updated) {
        return res.status(404).json({ ok: false, message: "Utilisateur introuvable" });
      }
      console.log(`✅ Push token saved for user ${userId} (${platform})`);
    }

    return res.status(200).json({
      ok: true,
      message: "Token push sauvegardé avec succès",
    });
  } catch (err: any) {
    console.error("Error saving push token:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
