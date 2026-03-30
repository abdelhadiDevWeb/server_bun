import { Router } from "express";
import type { Request, Response } from "express";
import { TypeAbonnement } from "../Models/TypeAbonnement";
import { ClientAbonnement } from "../Models/ClientAbonnement";
import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { authenticateToken, requireAdmin, requireSeller } from "../middleware/auth.middleware";

const router = Router();

// Admin: sync expired abonnements and update user/workshop status
router.post("/client/sync-expired", authenticateToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    // Get latest abonnement per client for Users
    const latestUserAbonnements = await ClientAbonnement.aggregate([
      { $match: { clientType: "User" } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$client",
          lastAbonnementId: { $first: "$_id" },
          date_end: { $first: "$date_end" },
        },
      },
    ]);

    // Get latest abonnement per client for Workshops
    const latestWorkshopAbonnements = await ClientAbonnement.aggregate([
      { $match: { clientType: "Workshop" } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$client",
          lastAbonnementId: { $first: "$_id" },
          date_end: { $first: "$date_end" },
        },
      },
    ]);

    const expiredUserIds = latestUserAbonnements
      .filter((a: any) => new Date(a.date_end) < now)
      .map((a: any) => a._id);
    const activeUserIds = latestUserAbonnements
      .filter((a: any) => new Date(a.date_end) >= now)
      .map((a: any) => a._id);

    const expiredWorkshopIds = latestWorkshopAbonnements
      .filter((a: any) => new Date(a.date_end) < now)
      .map((a: any) => a._id);
    const activeWorkshopIds = latestWorkshopAbonnements
      .filter((a: any) => new Date(a.date_end) >= now)
      .map((a: any) => a._id);

    // Expired subscriptions => status false
    const userExpiredResult = expiredUserIds.length
      ? await User.updateMany({ _id: { $in: expiredUserIds } }, { status: false })
      : { modifiedCount: 0 };
    const workshopExpiredResult = expiredWorkshopIds.length
      ? await Workshop.updateMany({ _id: { $in: expiredWorkshopIds } }, { status: false })
      : { modifiedCount: 0 };

    // Active subscriptions => ensure status true
    const userActiveResult = activeUserIds.length
      ? await User.updateMany({ _id: { $in: activeUserIds } }, { status: true })
      : { modifiedCount: 0 };
    const workshopActiveResult = activeWorkshopIds.length
      ? await Workshop.updateMany({ _id: { $in: activeWorkshopIds } }, { status: true })
      : { modifiedCount: 0 };

    return res.status(200).json({
      ok: true,
      message: "Synchronisation des abonnements expirés terminée",
      stats: {
        expiredUsers: expiredUserIds.length,
        expiredWorkshops: expiredWorkshopIds.length,
        reactivatedUsers: activeUserIds.length,
        reactivatedWorkshops: activeWorkshopIds.length,
        modifiedUsersExpired: userExpiredResult.modifiedCount || 0,
        modifiedWorkshopsExpired: workshopExpiredResult.modifiedCount || 0,
        modifiedUsersActive: userActiveResult.modifiedCount || 0,
        modifiedWorkshopsActive: workshopActiveResult.modifiedCount || 0,
      },
    });
  } catch (error: any) {
    console.error("Error syncing expired abonnements:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la synchronisation des abonnements expirés",
      error: error.message,
    });
  }
});

// Get all type abonnements
router.get("/types", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const types = await TypeAbonnement.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      ok: true,
      types,
    });
  } catch (error: any) {
    console.error("Error fetching type abonnements:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des types d'abonnement",
      error: error.message,
    });
  }
});

// Create single type abonnement
router.post("/types", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, time, price } = req.body;

    if (!name || !time || !price) {
      return res.status(400).json({
        ok: false,
        message: "Tous les champs sont requis (name, time, price)",
      });
    }

    const typeAbonnement = await TypeAbonnement.create({
      name,
      time: Number(time),
      price: Number(price),
    });

    return res.status(201).json({
      ok: true,
      message: "Type d'abonnement créé avec succès",
      type: typeAbonnement,
    });
  } catch (error: any) {
    console.error("Error creating type abonnement:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la création du type d'abonnement",
      error: error.message,
    });
  }
});

// Create multiple type abonnements
router.post("/types/bulk", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { types } = req.body;

    if (!Array.isArray(types) || types.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Un tableau de types d'abonnement est requis",
      });
    }

    // Validate each type
    for (const type of types) {
      if (!type.name || !type.time || !type.price) {
        return res.status(400).json({
          ok: false,
          message: "Chaque type doit avoir name, time et price",
        });
      }
    }

    const createdTypes = await TypeAbonnement.insertMany(
      types.map((type: any) => ({
        name: type.name,
        time: Number(type.time),
        price: Number(type.price),
      }))
    );

    return res.status(201).json({
      ok: true,
      message: `${createdTypes.length} type(s) d'abonnement créé(s) avec succès`,
      types: createdTypes,
    });
  } catch (error: any) {
    console.error("Error creating bulk type abonnements:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la création des types d'abonnement",
      error: error.message,
    });
  }
});

// Get users with status false
router.get("/users/inactive", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await User.find({ status: false })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      ok: true,
      users,
    });
  } catch (error: any) {
    console.error("Error fetching inactive users:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des utilisateurs inactifs",
      error: error.message,
    });
  }
});

// Get workshops with status false
router.get("/workshops/inactive", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const workshops = await Workshop.find({ status: false })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      ok: true,
      workshops,
    });
  } catch (error: any) {
    console.error("Error fetching inactive workshops:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des ateliers inactifs",
      error: error.message,
    });
  }
});

// Create client abonnement
router.post("/client", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type_abonnement, clientId, clientType } = req.body;

    if (!type_abonnement || !clientId || !clientType) {
      return res.status(400).json({
        ok: false,
        message: "type_abonnement, clientId et clientType sont requis",
      });
    }

    if (!['User', 'Workshop'].includes(clientType)) {
      return res.status(400).json({
        ok: false,
        message: "clientType doit être 'User' ou 'Workshop'",
      });
    }

    // Verify type abonnement exists
    const typeAbonnement = await TypeAbonnement.findById(type_abonnement);
    if (!typeAbonnement) {
      return res.status(404).json({
        ok: false,
        message: "Type d'abonnement non trouvé",
      });
    }

    // Verify client exists
    if (clientType === 'User') {
      const user = await User.findById(clientId);
      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "Utilisateur non trouvé",
        });
      }
    } else {
      const workshop = await Workshop.findById(clientId);
      if (!workshop) {
        return res.status(404).json({
          ok: false,
          message: "Atelier non trouvé",
        });
      }
    }

    // Calculate dates
    const date_start = new Date();
    const date_end = new Date();
    date_end.setDate(date_end.getDate() + typeAbonnement.time);

    const clientAbonnement = await ClientAbonnement.create({
      type_abonnement: type_abonnement,
      client: clientId,
      clientType: clientType,
      date_start,
      date_end,
      price: typeAbonnement.price,
    });

    // Update client status to true
    if (clientType === 'User') {
      await User.findByIdAndUpdate(clientId, { status: true });
    } else {
      await Workshop.findByIdAndUpdate(clientId, { status: true });
    }

    const populated = await ClientAbonnement.findById(clientAbonnement._id)
      .populate('type_abonnement')
      .lean();

    return res.status(201).json({
      ok: true,
      message: "Abonnement créé avec succès",
      abonnement: populated,
    });
  } catch (error: any) {
    console.error("Error creating client abonnement:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la création de l'abonnement",
      error: error.message,
    });
  }
});

// Get all client abonnements
router.get("/client", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const abonnements = await ClientAbonnement.find()
      .populate('type_abonnement')
      .sort({ createdAt: -1 })
      .lean();

    // Populate client information based on clientType
    const abonnementsWithClient = await Promise.all(
      abonnements.map(async (abonnement: any) => {
        let clientInfo = null;
        
        if (abonnement.clientType === 'User') {
          const user = await User.findById(abonnement.client).select('-password').lean();
          if (user) {
            clientInfo = {
              id: user._id?.toString() || user.id,
              name: `${user.firstName} ${user.lastName}`,
              email: user.email,
              phone: user.phone,
              type: 'User',
            };
          }
        } else if (abonnement.clientType === 'Workshop') {
          const workshop = await Workshop.findById(abonnement.client).select('-password').lean();
          if (workshop) {
            clientInfo = {
              id: workshop._id?.toString() || workshop.id,
              name: workshop.name,
              email: workshop.email,
              phone: workshop.phone,
              type: 'Workshop',
              workshopType: workshop.type,
            };
          }
        }

        return {
          ...abonnement,
          id: abonnement._id?.toString() || abonnement.id,
          type_abonnement: abonnement.type_abonnement ? {
            ...abonnement.type_abonnement,
            id: abonnement.type_abonnement._id?.toString() || abonnement.type_abonnement.id,
          } : null,
          clientInfo,
        };
      })
    );

    return res.status(200).json({
      ok: true,
      abonnements: abonnementsWithClient,
    });
  } catch (error: any) {
    console.error("Error fetching client abonnements:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération des abonnements",
      error: error.message,
    });
  }
});

// Admin: get last abonnement for a specific client (User/Workshop)
router.get("/client/last", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { clientId, clientType } = req.query;

    if (!clientId || typeof clientId !== "string") {
      return res.status(400).json({ ok: false, message: "clientId est requis" });
    }
    if (!clientType || typeof clientType !== "string" || !["User", "Workshop"].includes(clientType)) {
      return res.status(400).json({ ok: false, message: "clientType doit être 'User' ou 'Workshop'" });
    }

    const last = await ClientAbonnement.findOne({
      client: clientId,
      clientType,
    })
      .populate("type_abonnement")
      .sort({ createdAt: -1 })
      .lean();

    if (!last) {
      return res.status(200).json({
        ok: true,
        hasLast: false,
        abonnement: null,
      });
    }

    return res.status(200).json({
      ok: true,
      hasLast: true,
      abonnement: {
        ...last,
        id: (last as any)._id?.toString() || (last as any).id,
        type_abonnement: (last as any).type_abonnement
          ? {
              ...(last as any).type_abonnement,
              id: (last as any).type_abonnement._id?.toString() || (last as any).type_abonnement.id,
            }
          : null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching last abonnement:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération du dernier abonnement",
      error: error.message,
    });
  }
});

// Get current user's active subscription
router.get("/my-subscription", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Non authentifié",
      });
    }

    // Find active subscription for current user
    const now = new Date();
    const activeSubscription = await ClientAbonnement.findOne({
      client: userId,
      clientType: 'User',
      date_end: { $gte: now },
    })
      .populate('type_abonnement')
      .sort({ date_end: -1 })
      .lean();

    if (!activeSubscription) {
      return res.status(200).json({
        ok: true,
        hasSubscription: false,
        subscription: null,
      });
    }

    return res.status(200).json({
      ok: true,
      hasSubscription: true,
      subscription: {
        ...activeSubscription,
        id: activeSubscription._id?.toString() || activeSubscription.id,
        type_abonnement: activeSubscription.type_abonnement ? {
          ...activeSubscription.type_abonnement,
          id: activeSubscription.type_abonnement._id?.toString() || activeSubscription.type_abonnement.id,
        } : null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching user subscription:", error);
    return res.status(500).json({
      ok: false,
      message: "Erreur lors de la récupération de l'abonnement",
      error: error.message,
    });
  }
});

export default router;
