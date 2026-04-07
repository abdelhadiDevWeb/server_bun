import { Router } from "express";
import type { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { uploadUserImageSingle } from "../middleware/upload.middleware";
import { UserImage } from "../Models/UserImage";
import fs from "fs";
import path from "path";

const router = Router();

// Batch get user profile images by owner IDs (public)
// POST /api/user-image/batch { ownerIds: string[] } -> { ok: true, data: Record<ownerId, imagePath> }
router.post("/batch", async (req: Request, res: Response) => {
  try {
    const ownerIds = req.body?.ownerIds;
    if (!Array.isArray(ownerIds)) {
      return res.status(400).json({
        ok: false,
        message: "ownerIds must be an array of strings",
      });
    }
    const ids = ownerIds.filter((id: any) => typeof id === "string" && id.trim().length > 0).slice(0, 100);
    if (ids.length === 0) {
      return res.status(200).json({ ok: true, data: {} });
    }

    const images = await UserImage.find({ id_owner: { $in: ids } })
      .select("id_owner image")
      .lean();

    const map: Record<string, string> = {};
    for (const img of images) {
      if (img?.id_owner && img?.image) map[String(img.id_owner)] = String(img.image);
    }

    return res.status(200).json({ ok: true, data: map });
  } catch (err: any) {
    console.error("Batch get user images error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get user profile image by owner ID
router.get("/:ownerId", async (req: Request, res: Response) => {
  try {
    const ownerId = req.params.ownerId;

    const userImage = await UserImage.findOne({ id_owner: ownerId });

    if (!userImage) {
      return res.status(404).json({
        ok: false,
        message: "Image de profil non trouvée",
      });
    }

    return res.status(200).json({
      ok: true,
      userImage: userImage.toJSON(),
    });
  } catch (err: any) {
    console.error("Get user image error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Upload or update user profile image
router.post(
  "/upload",
  authenticateToken,
  uploadUserImageSingle,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        // Clean up uploaded file if unauthorized
        if (req.file) {
          const filePath = req.file.path;
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (err) {
              console.error("Error deleting file:", err);
            }
          }
        }
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "Aucune image fournie",
        });
      }

      const imagePath = `/uploads/users_images/${req.file.filename}`;

      // Check if user already has a profile image
      const existingImage = await UserImage.findOne({ id_owner: userId });

      if (existingImage) {
        // Delete old image file
        const oldImagePath = existingImage.image;
        const relativeImagePath = oldImagePath.startsWith('/uploads/users_images/')
          ? oldImagePath.substring('/uploads/users_images/'.length)
          : oldImagePath.replace(/^\/uploads\/users_images\//, '');
        const fullPath = path.join(process.cwd(), 'uploads', 'users_images', relativeImagePath);
        
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch (err) {
            console.error("Error deleting old image file:", err);
          }
        }

        // Update existing image
        existingImage.image = imagePath;
        await existingImage.save();

        return res.status(200).json({
          ok: true,
          message: "Image de profil mise à jour avec succès",
          userImage: existingImage.toJSON(),
        });
      } else {
        // Create new image record
        const newUserImage = new UserImage({
          id_owner: userId,
          image: imagePath,
        });

        await newUserImage.save();

        return res.status(201).json({
          ok: true,
          message: "Image de profil uploadée avec succès",
          userImage: newUserImage.toJSON(),
        });
      }
    } catch (err: any) {
      // Clean up uploaded file on error
      if (req.file) {
        const filePath = req.file.path;
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (deleteErr) {
            console.error("Error deleting file:", deleteErr);
          }
        }
      }

      console.error("Upload user image error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Delete user profile image
router.delete(
  "/delete",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      const userImage = await UserImage.findOne({ id_owner: userId });

      if (!userImage) {
        return res.status(404).json({
          ok: false,
          message: "Image de profil non trouvée",
        });
      }

      // Delete image file from filesystem
      const imagePath = userImage.image;
      const relativeImagePath = imagePath.startsWith('/uploads/users_images/')
        ? imagePath.substring('/uploads/users_images/'.length)
        : imagePath.replace(/^\/uploads\/users_images\//, '');
      const fullPath = path.join(process.cwd(), 'uploads', 'users_images', relativeImagePath);

      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          console.error("Error deleting image file:", err);
        }
      }

      // Delete from database
      await UserImage.findByIdAndDelete(userImage._id);

      return res.status(200).json({
        ok: true,
        message: "Image de profil supprimée avec succès",
      });
    } catch (err: any) {
      console.error("Delete user image error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

export default router;
