import { Router } from "express";
import type { Request, Response } from "express";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { Car } from "../Models/Car";
import { ClientAbonnement } from "../Models/ClientAbonnement";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { authenticateToken, requireAdmin } from "../middleware/auth.middleware";
import bcrypt from "bcrypt";
import Joi from "joi";
import { uploadUserImageSingle } from "../middleware/upload.middleware";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";

const router = Router();

// Get all users and workshops
router.get("/users", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    
    // Build search query for users
    let userQuery: any = {};
    if (search && typeof search === 'string') {
      const searchRegex = new RegExp(search, 'i');
      userQuery = {
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
        ]
      };
    }

    // Build search query for workshops
    let workshopQuery: any = {};
    if (search && typeof search === 'string') {
      const searchRegex = new RegExp(search, 'i');
      workshopQuery = {
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
        ]
      };
    }

    const users = await User.find(userQuery).select('-password').sort({ createdAt: -1 }).lean();
    const workshops = await Workshop.find(workshopQuery).select('-password').sort({ createdAt: -1 }).lean();

    // Map _id to id for users
    const usersWithId = users.map((user: any) => ({
      ...user,
      id: user._id?.toString() || user.id,
    }));

    // Map _id to id for workshops
    const workshopsWithId = workshops.map((workshop: any) => ({
      ...workshop,
      id: workshop._id?.toString() || workshop.id,
    }));

    return res.status(200).json({
      ok: true,
      users: usersWithId,
      workshops: workshopsWithId,
    });
  } catch (error: any) {
    console.error("Error fetching users and workshops:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des utilisateurs et ateliers",
      error: error.message,
    });
  }
});

// Update user status
router.patch("/users/:id/status", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log("🔧 Updating user status:", { id, status, statusType: typeof status });

    if (typeof status !== 'boolean') {
      console.error("❌ Invalid status type:", typeof status);
      return res.status(400).json({
        ok: false,
        message: "Le statut doit être un booléen (true/false)",
      });
    }

    // Validate MongoDB ObjectId format (should be 24 hex characters)
    if (!id) {
      console.error("❌ Missing user ID");
      return res.status(400).json({
        ok: false,
        message: "ID utilisateur manquant",
      });
    }

    // Check if it's a valid MongoDB ObjectId format
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    if (!isValidObjectId) {
      console.error("❌ Invalid user ID format:", id, "Length:", id.length);
      return res.status(400).json({
        ok: false,
        message: `Format d'ID utilisateur invalide: ${id}`,
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).select('-password').lean();

    if (!user) {
      console.error("❌ User not found:", id);
      return res.status(404).json({
        ok: false,
        message: "Utilisateur non trouvé",
      });
    }

    console.log("✅ User status updated successfully:", user.email);

    // Map _id to id
    const userWithId = {
      ...user,
      id: (user as any)._id?.toString() || (user as any).id,
    };

    return res.status(200).json({
      ok: true,
      message: "Statut de l'utilisateur mis à jour",
      user: userWithId,
    });
  } catch (error: any) {
    console.error("❌ Error updating user status:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la mise à jour du statut",
      error: error.message,
    });
  }
});

// Update workshop status
router.patch("/workshops/:id/status", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log("🔧 Updating workshop status:", { id, status, statusType: typeof status });

    if (typeof status !== 'boolean') {
      console.error("❌ Invalid status type:", typeof status);
      return res.status(400).json({
        ok: false,
        message: "Le statut doit être un booléen (true/false)",
      });
    }

    // Validate MongoDB ObjectId format (should be 24 hex characters)
    if (!id) {
      console.error("❌ Missing workshop ID");
      return res.status(400).json({
        ok: false,
        message: "ID atelier manquant",
      });
    }

    // Check if it's a valid MongoDB ObjectId format
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    if (!isValidObjectId) {
      console.error("❌ Invalid workshop ID format:", id, "Length:", id.length);
      return res.status(400).json({
        ok: false,
        message: `Format d'ID atelier invalide: ${id}`,
      });
    }

    const workshop = await Workshop.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).select('-password').lean();

    if (!workshop) {
      console.error("❌ Workshop not found:", id);
      return res.status(404).json({
        ok: false,
        message: "Atelier non trouvé",
      });
    }

    console.log("✅ Workshop status updated successfully:", workshop.email);

    // Map _id to id
    const workshopWithId = {
      ...workshop,
      id: (workshop as any)._id?.toString() || (workshop as any).id,
    };

    return res.status(200).json({
      ok: true,
      message: "Statut de l'atelier mis à jour",
      workshop: workshopWithId,
    });
  } catch (error: any) {
    console.error("❌ Error updating workshop status:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la mise à jour du statut",
      error: error.message,
    });
  }
});

// Get statistics for admin dashboard
router.get("/statistics", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    // Get current date and calculate date ranges
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    
    // Get last 6 months for chart data
    const monthsData = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsData.push({
        month: monthDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        monthIndex: monthDate.getMonth(),
        year: monthDate.getFullYear(),
      });
    }

    // Total counts
    const [
      totalUsers,
      totalWorkshops,
      totalCars,
      activeCars,
      certifiedCars,
      soldCars,
      activeUsers,
      activeWorkshops,
      totalAbonnements,
      activeAbonnements,
    ] = await Promise.all([
      User.countDocuments(),
      Workshop.countDocuments(),
      Car.countDocuments(),
      Car.countDocuments({ status: 'actif' }),
      Car.countDocuments({ status: 'actif' }), // Assuming certified = active
      Car.countDocuments({ status: 'sold' }),
      User.countDocuments({ status: true }),
      Workshop.countDocuments({ status: true }),
      ClientAbonnement.countDocuments(),
      ClientAbonnement.countDocuments({ date_end: { $gte: now } }),
    ]);

    // Last month counts for comparison
    const [
      lastMonthUsers,
      lastMonthCars,
      lastMonthCertified,
    ] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: startOfLastMonth, $lt: startOfMonth } }),
      Car.countDocuments({ createdAt: { $gte: startOfLastMonth, $lt: startOfMonth } }),
      Car.countDocuments({ status: 'actif', createdAt: { $gte: startOfLastMonth, $lt: startOfMonth } }),
    ]);

    // Calculate percentage changes
    const userChange = lastMonthUsers > 0 ? ((totalUsers - lastMonthUsers) / lastMonthUsers * 100).toFixed(1) : '0';
    const carChange = lastMonthCars > 0 ? ((totalCars - lastMonthCars) / lastMonthCars * 100).toFixed(1) : '0';

    // Monthly data for charts
    const monthlyInspections = await Promise.all(
      monthsData.map(async (m) => {
        const monthStart = new Date(m.year, m.monthIndex, 1);
        const monthEnd = new Date(m.year, m.monthIndex + 1, 0, 23, 59, 59);
        
        // Count appointments/inspections for this month
        // Note: You'll need to adjust this based on your RdvWorkshop model
        const inspections = await Car.countDocuments({
          createdAt: { $gte: monthStart, $lte: monthEnd },
          status: 'actif',
        });
        
        const certified = await Car.countDocuments({
          createdAt: { $gte: monthStart, $lte: monthEnd },
          status: 'actif',
        });

        return {
          month: m.month,
          inspections,
          certified,
        };
      })
    );

    // Cars by status
    const carsByStatus = await Promise.all([
      { status: 'no_proccess', count: await Car.countDocuments({ status: 'no_proccess' }) },
      { status: 'en_attente', count: await Car.countDocuments({ status: 'en_attente' }) },
      { status: 'actif', count: await Car.countDocuments({ status: 'actif' }) },
      { status: 'sold', count: await Car.countDocuments({ status: 'sold' }) },
    ]);

    // Cars by brand (top 10)
    const carsByBrand = await Car.aggregate([
      { $group: { _id: '$brand', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Recent users (last 5)
    const recentUsers = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Recent cars (last 5)
    const recentCars = await Car.find()
      .populate('owner', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Revenue from abonnements (this month)
    const thisMonthRevenue = await ClientAbonnement.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth, $lte: now },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$price' },
        },
      },
    ]);

    const totalRevenue = thisMonthRevenue[0]?.total || 0;

    // Map _id to id for recent users
    const recentUsersWithId = recentUsers.map((user: any) => ({
      ...user,
      id: user._id?.toString() || user.id,
    }));

    // Map _id to id for recent cars
    const recentCarsWithId = recentCars.map((car: any) => ({
      ...car,
      id: car._id?.toString() || car.id,
      owner: car.owner ? {
        ...car.owner,
        id: (car.owner as any)._id?.toString() || (car.owner as any).id,
      } : null,
    }));

    return res.status(200).json({
      ok: true,
      statistics: {
        overview: {
          totalUsers,
          totalWorkshops,
          totalCars,
          activeCars,
          certifiedCars,
          soldCars,
          activeUsers,
          activeWorkshops,
          totalAbonnements,
          activeAbonnements,
          userChange: parseFloat(userChange),
          carChange: parseFloat(carChange),
        },
        monthly: monthlyInspections,
        carsByStatus,
        carsByBrand: carsByBrand.map((item: any) => ({
          brand: item._id,
          count: item.count,
        })),
        recentUsers: recentUsersWithId,
        recentCars: recentCarsWithId,
        revenue: {
          thisMonth: totalRevenue,
        },
      },
    });
  } catch (error: any) {
    console.error("Error fetching statistics:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des statistiques",
      error: error.message,
    });
  }
});

// Get all cars for admin
router.get("/cars", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;
    
    // Build query
    let query: any = {};
    
    if (status && typeof status === 'string') {
      query.status = status;
    }
    
    if (search && typeof search === 'string') {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { brand: searchRegex },
        { model: searchRegex },
      ];
    }

    const cars = await Car.find(query)
      .populate('owner', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .lean();

    // Get rdvWorkshop data for each car
    const carsWithId = await Promise.all(
      cars.map(async (car: any) => {
        // Get all rdvWorkshop for this car with status 'finish'
        const rdvWorkshops = await RendezVousWorkshop.find({
          id_car: car._id,
          status: 'finish',
        })
          .populate('id_workshop', 'name email')
          .lean();

        const rdvData = rdvWorkshops.map((rdv: any) => ({
          id: rdv._id?.toString() || rdv.id,
          workshop: rdv.id_workshop ? {
            id: (rdv.id_workshop as any)._id?.toString() || (rdv.id_workshop as any).id,
            name: (rdv.id_workshop as any).name,
            email: (rdv.id_workshop as any).email,
          } : null,
          images: rdv.images || [],
          rapport_pdf: rdv.rapport_pdf || null,
          date: rdv.date,
          time: rdv.time,
          createdAt: rdv.createdAt,
        }));

        return {
          ...car,
          id: car._id?.toString() || car.id,
          owner: car.owner ? {
            ...car.owner,
            id: (car.owner as any)._id?.toString() || (car.owner as any).id,
          } : null,
          rdvWorkshops: rdvData,
        };
      })
    );

    return res.status(200).json({
      ok: true,
      cars: carsWithId,
    });
  } catch (error: any) {
    console.error("Error fetching cars:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des véhicules",
      error: error.message,
    });
  }
});

// Get financial data for admin
router.get("/finance", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Get last 12 months for chart data
    const monthsData = [];
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsData.push({
        month: monthDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        monthIndex: monthDate.getMonth(),
        year: monthDate.getFullYear(),
      });
    }

    // Get all abonnements
    const allAbonnements = await ClientAbonnement.find()
      .populate('type_abonnement')
      .sort({ createdAt: -1 })
      .lean();

    // Calculate totals
    const totalRevenue = allAbonnements.reduce((sum, ab: any) => sum + (ab.price || 0), 0);
    const thisMonthRevenue = allAbonnements
      .filter((ab: any) => {
        const created = new Date(ab.createdAt);
        return created >= startOfMonth && created <= now;
      })
      .reduce((sum, ab: any) => sum + (ab.price || 0), 0);
    
    const lastMonthRevenue = allAbonnements
      .filter((ab: any) => {
        const created = new Date(ab.createdAt);
        return created >= startOfLastMonth && created < startOfMonth;
      })
      .reduce((sum, ab: any) => sum + (ab.price || 0), 0);

    const thisYearRevenue = allAbonnements
      .filter((ab: any) => {
        const created = new Date(ab.createdAt);
        return created >= startOfYear && created <= now;
      })
      .reduce((sum, ab: any) => sum + (ab.price || 0), 0);

    // Monthly revenue data
    const monthlyRevenue = await Promise.all(
      monthsData.map(async (m) => {
        const monthStart = new Date(m.year, m.monthIndex, 1);
        const monthEnd = new Date(m.year, m.monthIndex + 1, 0, 23, 59, 59);
        
        const monthAbonnements = allAbonnements.filter((ab: any) => {
          const created = new Date(ab.createdAt);
          return created >= monthStart && created <= monthEnd;
        });

        const revenue = monthAbonnements.reduce((sum, ab: any) => sum + (ab.price || 0), 0);
        const count = monthAbonnements.length;

        return {
          month: m.month,
          revenue,
          count,
        };
      })
    );

    // Revenue by subscription type
    const revenueByType = await ClientAbonnement.aggregate([
      {
        $lookup: {
          from: 'typeabonnements',
          localField: 'type_abonnement',
          foreignField: '_id',
          as: 'type'
        }
      },
      {
        $unwind: '$type'
      },
      {
        $group: {
          _id: '$type.name',
          totalRevenue: { $sum: '$price' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { totalRevenue: -1 }
      }
    ]);

    // Revenue by client type
    const revenueByClientType = await ClientAbonnement.aggregate([
      {
        $group: {
          _id: '$clientType',
          totalRevenue: { $sum: '$price' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent transactions (last 10)
    const recentTransactions = allAbonnements.slice(0, 10).map((ab: any) => {
      // Get client info
      let clientInfo = null;
      if (ab.clientType === 'User') {
        // We'll populate this separately if needed
        clientInfo = { type: 'User', id: ab.client };
      } else {
        clientInfo = { type: 'Workshop', id: ab.client };
      }

      return {
        id: ab._id?.toString() || ab.id,
        type: ab.type_abonnement?.name || 'N/A',
        clientType: ab.clientType,
        price: ab.price,
        date_start: ab.date_start,
        date_end: ab.date_end,
        createdAt: ab.createdAt,
        clientInfo,
      };
    });

    // Populate client info for recent transactions
    const recentTransactionsWithClient = await Promise.all(
      recentTransactions.map(async (transaction) => {
        let clientInfo = null;
        
        if (transaction.clientType === 'User') {
          const user = await User.findById(transaction.clientInfo.id).select('-password').lean();
          if (user) {
            clientInfo = {
              type: 'User',
              name: `${user.firstName} ${user.lastName}`,
              email: user.email,
            };
          }
        } else {
          const workshop = await Workshop.findById(transaction.clientInfo.id).select('-password').lean();
          if (workshop) {
            clientInfo = {
              type: 'Workshop',
              name: workshop.name,
              email: workshop.email,
            };
          }
        }

        return {
          ...transaction,
          clientInfo,
        };
      })
    );

    // Calculate growth
    const growth = lastMonthRevenue > 0 
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
      : '0';

    return res.status(200).json({
      ok: true,
      finance: {
        overview: {
          totalRevenue,
          thisMonthRevenue,
          lastMonthRevenue,
          thisYearRevenue,
          growth: parseFloat(growth),
          totalTransactions: allAbonnements.length,
        },
        monthly: monthlyRevenue,
        byType: revenueByType.map((item: any) => ({
          type: item._id,
          revenue: item.totalRevenue,
          count: item.count,
        })),
        byClientType: revenueByClientType.map((item: any) => ({
          clientType: item._id,
          revenue: item.totalRevenue,
          count: item.count,
        })),
        recentTransactions: recentTransactionsWithClient,
      },
    });
  } catch (error: any) {
    console.error("Error fetching finance data:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des données financières",
      error: error.message,
    });
  }
});

// Get current admin profile
router.get("/profile", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const user = await User.findById(userId).select('-password').lean();
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Utilisateur non trouvé",
      });
    }

    return res.status(200).json({
      ok: true,
      user: {
        ...user,
        id: user._id?.toString() || user.id,
      },
    });
  } catch (error: any) {
    console.error("Error fetching profile:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération du profil",
      error: error.message,
    });
  }
});

// Update admin profile
const updateProfileSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).optional(),
  lastName: Joi.string().trim().min(2).max(50).optional(),
  email: Joi.string().email().trim().lowercase().optional(),
  phone: Joi.string().trim().optional(),
});

router.patch("/profile", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const { error, value } = updateProfileSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        ok: false,
        message: "Erreur de validation",
        errors,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Utilisateur non trouvé",
      });
    }

    // Check if email is already taken by another user
    if (value.email && value.email !== user.email) {
      const existingUser = await User.findOne({ email: value.email });
      if (existingUser) {
        return res.status(400).json({
          ok: false,
          message: "Cet email est déjà utilisé",
        });
      }
    }

    // Check if phone is already taken by another user
    if (value.phone && value.phone !== user.phone) {
      const existingUser = await User.findOne({ phone: value.phone });
      if (existingUser) {
        return res.status(400).json({
          ok: false,
          message: "Ce numéro de téléphone est déjà utilisé",
        });
      }
    }

    // Update fields
    if (value.firstName) user.firstName = value.firstName;
    if (value.lastName) user.lastName = value.lastName;
    if (value.email) user.email = value.email;
    if (value.phone) user.phone = value.phone;

    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      ok: true,
      message: "Profil mis à jour avec succès",
      user: {
        ...userResponse,
        id: userResponse._id?.toString() || userResponse.id,
      },
    });
  } catch (error: any) {
    console.error("Error updating profile:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la mise à jour du profil",
      error: error.message,
    });
  }
});

// Upload profile image
router.post("/profile/image", authenticateToken, requireAdmin, uploadUserImageSingle, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "Aucun fichier fourni",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Utilisateur non trouvé",
      });
    }

    // Delete old profile image if exists
    if (user.profileImage) {
      const oldImagePath = path.join(process.cwd(), user.profileImage);
      if (fs.existsSync(oldImagePath)) {
        try {
          fs.unlinkSync(oldImagePath);
        } catch (err) {
          console.error("Error deleting old profile image:", err);
        }
      }
    }

    // Save new profile image path
    const imagePath = `uploads/users_images/${req.file.filename}`;
    user.profileImage = imagePath;
    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      ok: true,
      message: "Image de profil mise à jour avec succès",
      user: {
        ...userResponse,
        id: userResponse._id?.toString() || userResponse.id,
      },
    });
  } catch (error: any) {
    console.error("Error uploading profile image:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de l'upload de l'image",
      error: error.message,
    });
  }
});

// Change admin password
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    "any.required": "Le mot de passe actuel est requis",
  }),
  newPassword: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      "string.min": "Le nouveau mot de passe doit contenir au moins 8 caractères",
      "string.max": "Le nouveau mot de passe ne peut pas dépasser 128 caractères",
      "string.pattern.base":
        "Le nouveau mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial",
      "any.required": "Le nouveau mot de passe est requis",
    }),
});

router.put("/password", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const { error, value } = changePasswordSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        ok: false,
        message: "Erreur de validation",
        errors,
      });
    }

    const { currentPassword, newPassword } = value;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Utilisateur non trouvé",
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        ok: false,
        message: "Mot de passe actuel incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({
      ok: true,
      message: "Mot de passe modifié avec succès",
    });
  } catch (error: any) {
    console.error("Error changing password:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la modification du mot de passe",
      error: error.message,
    });
  }
});

// Get all admins (except current user)
router.get("/admins", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const admins = await User.find({ role: 'admin' })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    // Filter out current user and map _id to id
    const adminsWithId = admins
      .filter((admin: any) => admin._id?.toString() !== userId)
      .map((admin: any) => ({
        ...admin,
        id: admin._id?.toString() || admin.id,
      }));

    return res.status(200).json({
      ok: true,
      admins: adminsWithId,
    });
  } catch (error: any) {
    console.error("Error fetching admins:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des administrateurs",
      error: error.message,
    });
  }
});

// Create new admin
const createAdminSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).required().messages({
    "any.required": "Le prénom est requis",
    "string.min": "Le prénom doit contenir au moins 2 caractères",
    "string.max": "Le prénom ne peut pas dépasser 50 caractères",
  }),
  lastName: Joi.string().trim().min(2).max(50).required().messages({
    "any.required": "Le nom est requis",
    "string.min": "Le nom doit contenir au moins 2 caractères",
    "string.max": "Le nom ne peut pas dépasser 50 caractères",
  }),
  email: Joi.string().email().trim().lowercase().required().messages({
    "any.required": "L'email est requis",
    "string.email": "Format d'email invalide",
  }),
  phone: Joi.string().trim().required().messages({
    "any.required": "Le numéro de téléphone est requis",
  }),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      "any.required": "Le mot de passe est requis",
      "string.min": "Le mot de passe doit contenir au moins 8 caractères",
      "string.max": "Le mot de passe ne peut pas dépasser 128 caractères",
      "string.pattern.base":
        "Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial",
    }),
});

router.post("/admins", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { error, value } = createAdminSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        ok: false,
        message: "Erreur de validation",
        errors,
      });
    }

    const { firstName, lastName, email, phone, password } = value;

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        ok: false,
        message: "Cet email est déjà utilisé",
      });
    }

    // Check if phone already exists
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({
        ok: false,
        message: "Ce numéro de téléphone est déjà utilisé",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user
    const newAdmin = new User({
      firstName,
      lastName,
      email,
      phone,
      password: hashedPassword,
      role: 'admin',
      status: false, // Admin status is false by default
      verfie: true, // Admin is automatically verified
    });

    await newAdmin.save();

    const adminResponse = newAdmin.toObject();
    delete adminResponse.password;

    return res.status(201).json({
      ok: true,
      message: "Administrateur créé avec succès",
      admin: {
        ...adminResponse,
        id: adminResponse._id?.toString() || adminResponse.id,
      },
    });
  } catch (error: any) {
    console.error("Error creating admin:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la création de l'administrateur",
      error: error.message,
    });
  }
});

// Update admin status
router.patch("/admins/:id/status", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log("Update admin status - ID:", id, "Status:", status, "User ID:", req.user?.id);

    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "ID administrateur manquant",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID administrateur invalide",
      });
    }

    if (typeof status !== 'boolean') {
      return res.status(400).json({
        ok: false,
        message: "Le statut doit être un booléen",
      });
    }

    // Don't allow changing own status
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    // Convert both to strings for comparison
    const currentUserIdStr = String(currentUserId);
    const idStr = String(id);
    
    if (idStr === currentUserIdStr) {
      return res.status(400).json({
        ok: false,
        message: "Vous ne pouvez pas modifier votre propre statut",
      });
    }

    const admin = await User.findById(id);
    if (!admin) {
      return res.status(404).json({
        ok: false,
        message: "Administrateur non trouvé",
      });
    }

    if (admin.role !== 'admin') {
      return res.status(400).json({
        ok: false,
        message: "Cet utilisateur n'est pas un administrateur",
      });
    }

    admin.status = status;
    await admin.save();

    const adminResponse = admin.toObject();
    delete adminResponse.password;

    console.log("Admin status updated successfully:", adminResponse._id, "New status:", status);

    return res.status(200).json({
      ok: true,
      message: `Statut de l'administrateur ${status ? 'activé' : 'désactivé'} avec succès`,
      admin: {
        ...adminResponse,
        id: adminResponse._id?.toString() || adminResponse.id,
      },
    });
  } catch (error: any) {
    console.error("Error updating admin status:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la mise à jour du statut",
      error: error.message,
    });
  }
});

// Get monthly revenue
router.get("/monthly-revenue", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Get all abonnements for current month
    const monthlyAbonnements = await ClientAbonnement.find({
      createdAt: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    });

    const monthlyRevenue = monthlyAbonnements.reduce((total, abonnement) => {
      return total + (abonnement.price || 0);
    }, 0);

    return res.status(200).json({
      ok: true,
      monthlyRevenue: monthlyRevenue,
      month: now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    });
  } catch (error: any) {
    console.error("Error fetching monthly revenue:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération du revenu mensuel",
      error: error.message,
    });
  }
});

export default router;
