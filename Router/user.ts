import { Router } from "express";
import type { Request, Response } from "express";
import { User } from "../Models/User";
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

    // Update user with push token
    await User.findByIdAndUpdate(userId, {
      pushToken,
      platform,
      deviceId: deviceId || null,
      pushTokenUpdatedAt: new Date(),
    });

    console.log(`✅ Push token saved for user ${userId} (${platform})`);

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
