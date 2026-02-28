import { Router } from "express";
import type { Request, Response } from "express";
import { User } from "../Models/User";

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

export default router;
