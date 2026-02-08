import { Router } from "express";
import type { Request, Response } from "express";
import { Car } from "../Models/Car";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";

const router = Router();

// Get statistics
router.get("/", async (req: Request, res: Response) => {
  try {
    // Count active cars
    const activeCarsCount = await Car.countDocuments({ status: 'actif' });
    
    // Count all cars
    const totalCarsCount = await Car.countDocuments();
    
    // Count verified users (status: true)
    const verifiedUsersCount = await User.countDocuments({ status: true });
    
    // Count all users
    const totalUsersCount = await User.countDocuments();
    
    // Count verified workshops (status: true)
    const verifiedWorkshopsCount = await Workshop.countDocuments({ status: true });
    
    // Count all workshops
    const totalWorkshopsCount = await Workshop.countDocuments();

    return res.status(200).json({
      ok: true,
      stats: {
        activeCars: activeCarsCount,
        totalCars: totalCarsCount,
        verifiedUsers: verifiedUsersCount,
        totalUsers: totalUsersCount,
        verifiedWorkshops: verifiedWorkshopsCount,
        totalWorkshops: totalWorkshopsCount,
      },
    });
  } catch (err: any) {
    console.error("Get statistics error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
