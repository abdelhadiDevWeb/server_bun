import { Router } from "express";
import type { Request, Response } from "express";
import { Car } from "../Models/Car";
import { User } from "../Models/User";
import { authenticateToken, requireSeller } from "../middleware/auth.middleware";
import { uploadMultiple } from "../middleware/upload.middleware";
import { validate, validationSchemas } from "../middleware/validation.middleware";
import Joi from "joi";

const router = Router();

// Validation schema for car creation
const createCarSchema = Joi.object({
  brand: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .required()
    .messages({
      "string.min": "La marque doit contenir au moins 2 caractères",
      "string.max": "La marque ne peut pas dépasser 50 caractères",
      "any.required": "La marque est requise",
    }),
  model: Joi.string()
    .trim()
    .min(1)
    .max(50)
    .required()
    .messages({
      "string.min": "Le modèle doit contenir au moins 1 caractère",
      "string.max": "Le modèle ne peut pas dépasser 50 caractères",
      "any.required": "Le modèle est requis",
    }),
  year: Joi.number()
    .integer()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .required()
    .messages({
      "number.min": "L'année doit être supérieure à 1900",
      "number.max": "L'année ne peut pas être dans le futur",
      "any.required": "L'année est requise",
    }),
  km: Joi.number()
    .integer()
    .min(0)
    .required()
    .messages({
      "number.min": "Le kilométrage ne peut pas être négatif",
      "any.required": "Le kilométrage est requis",
    }),
  price: Joi.number()
    .min(0)
    .required()
    .messages({
      "number.min": "Le prix ne peut pas être négatif",
      "any.required": "Le prix est requis",
    }),
  // Status is not sent by user, it's set by admin/system
  // Default will be 'no_proccess' in the model
});

// Create car endpoint
router.post(
  "/create",
  authenticateToken,
  requireSeller,
  (req: Request, res: Response, next: any) => {
    // Store user data before multer processes the request
    const userData = req.user;
    
    // Call multer middleware
    uploadMultiple(req, res, (err: any) => {
      if (err) {
        console.error("❌ Multer error:", err);
        return res.status(400).json({
          ok: false,
          message: err.message || "Erreur lors de l'upload des images",
        });
      }
      
      // Restore user data after multer (in case it was lost)
      if (userData && !req.user) {
        req.user = userData;
      }
      
      next();
    });
  },
  (req: Request, res: Response) => {
    try {
      // Validate text fields (after multer has processed files)
      const { error, value } = createCarSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        // Clean up uploaded files if validation fails
        if (req.files && Array.isArray(req.files)) {
          const fs = require("fs");
          req.files.forEach((file: Express.Multer.File) => {
            if (fs.existsSync(file.path)) {
              try {
                fs.unlinkSync(file.path);
              } catch (err) {
                console.error("Error deleting file:", err);
              }
            }
          });
        }

        const errors = error.details.map((detail) => detail.message);
        return res.status(400).json({
          ok: false,
          message: "Erreur de validation",
          errors,
        });
      }

      // Check if images were uploaded
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({
          ok: false,
          message: "Au moins une image est requise",
        });
      }

      // Get user ID from authenticated request
      console.log("🚗 Create car - req.user:", req.user);
      const userId = req.user?.id;
      if (!userId) {
        console.log("❌ Create car - No user ID found in request");
        // Clean up uploaded files
        if (req.files && Array.isArray(req.files)) {
          const fs = require("fs");
          req.files.forEach((file: Express.Multer.File) => {
            if (fs.existsSync(file.path)) {
              try {
                fs.unlinkSync(file.path);
              } catch (err) {
                console.error("Error deleting file:", err);
              }
            }
          });
        }

        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      console.log("✅ Create car - User ID:", userId);

      // Get image paths
      const imagePaths = (req.files as Express.Multer.File[]).map(
        (file) => `/uploads/images/${file.filename}`
      );

      // Create car - status defaults to 'no_proccess' in model
      const carData = {
        ...value,
        images: imagePaths,
        owner: userId,
        status: 'no_proccess', // Explicitly set default status
      };

      Car.create(carData)
        .then((car) => {
          return res.status(201).json({
            ok: true,
            message: "Voiture ajoutée avec succès",
            car: car.toJSON(),
          });
        })
        .catch((err) => {
          // Clean up uploaded files if car creation fails
          if (req.files && Array.isArray(req.files)) {
            const fs = require("fs");
            req.files.forEach((file: Express.Multer.File) => {
              if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
              }
            });
          }

          console.error("Error creating car:", err);
          return res.status(500).json({
            ok: false,
            message: err?.message ?? "Erreur lors de la création de la voiture",
          });
        });
    } catch (err: any) {
      // Clean up uploaded files on error
      if (req.files && Array.isArray(req.files)) {
        const fs = require("fs");
        req.files.forEach((file: Express.Multer.File) => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      }

      console.error("Error in create car:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Get user's cars
router.get("/my-cars", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const cars = await Car.find({ owner: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      ok: true,
      cars,
    });
  } catch (err: any) {
    console.error("Error fetching cars:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get single car by ID (public endpoint) - must be after specific routes like /my-cars
// Get all active cars (public endpoint) with optional search filters
router.get("/active", async (req: Request, res: Response) => {
  try {
    const { brand, model, maxPrice, maxKm } = req.query;

    // Build query
    const query: any = { status: 'actif' };

    if (brand && typeof brand === 'string') {
      query.brand = { $regex: brand, $options: 'i' };
    }

    if (model && typeof model === 'string') {
      query.model = { $regex: model, $options: 'i' };
    }

    if (maxPrice && typeof maxPrice === 'string') {
      const maxPriceNum = parseInt(maxPrice);
      if (!isNaN(maxPriceNum)) {
        query.price = { $lte: maxPriceNum };
      }
    }

    if (maxKm && typeof maxKm === 'string') {
      const maxKmNum = parseInt(maxKm);
      if (!isNaN(maxKmNum)) {
        query.km = { $lte: maxKmNum };
      }
    }

    const cars = await Car.find(query)
      .populate('owner', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      ok: true,
      cars: cars.map(car => ({
        ...car,
        id: car._id?.toString(),
      })),
    });
  } catch (err: any) {
    console.error("Get active cars error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const carId = req.params.id;
    const car = await Car.findById(carId)
      .populate('owner', 'firstName lastName email phone')
      .lean();

    if (!car) {
      return res.status(404).json({
        ok: false,
        message: "Voiture non trouvée",
      });
    }

    return res.status(200).json({
      ok: true,
      car,
    });
  } catch (err: any) {
    console.error("Error fetching car:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Update car endpoint (user can update data but not status)
const updateCarSchema = Joi.object({
  brand: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .optional()
    .messages({
      "string.min": "La marque doit contenir au moins 2 caractères",
      "string.max": "La marque ne peut pas dépasser 50 caractères",
    }),
  model: Joi.string()
    .trim()
    .min(1)
    .max(50)
    .optional()
    .messages({
      "string.min": "Le modèle doit contenir au moins 1 caractère",
      "string.max": "Le modèle ne peut pas dépasser 50 caractères",
    }),
  year: Joi.number()
    .integer()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional()
    .messages({
      "number.min": "L'année doit être supérieure à 1900",
      "number.max": "L'année ne peut pas être dans le futur",
    }),
  km: Joi.number()
    .integer()
    .min(0)
    .optional()
    .messages({
      "number.min": "Le kilométrage ne peut pas être négatif",
    }),
  price: Joi.number()
    .min(0)
    .optional()
    .messages({
      "number.min": "Le prix ne peut pas être négatif",
    }),
  // Status is not allowed to be updated by user
});

router.put(
  "/update/:id",
  authenticateToken,
  requireSeller,
  (req: Request, res: Response, next: any) => {
    // Store user data before multer processes the request
    const userData = req.user;
    
    // Check if request has files (multipart/form-data)
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      // Call multer middleware for image uploads
      uploadMultiple(req, res, (err: any) => {
        if (err) {
          console.error("❌ Multer error:", err);
          return res.status(400).json({
            ok: false,
            message: err.message || "Erreur lors de l'upload des images",
          });
        }
        
        // Restore user data after multer
        if (userData && !req.user) {
          req.user = userData;
        }
        
        next();
      });
    } else {
      // No files, proceed normally
      next();
    }
  },
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const carId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      // Find car and verify ownership
      const car = await Car.findById(carId);
      if (!car) {
        // Clean up uploaded files if car not found
        if (req.files && Array.isArray(req.files)) {
          const fs = require("fs");
          req.files.forEach((file: Express.Multer.File) => {
            if (fs.existsSync(file.path)) {
              try {
                fs.unlinkSync(file.path);
              } catch (err) {
                console.error("Error deleting file:", err);
              }
            }
          });
        }
        return res.status(404).json({
          ok: false,
          message: "Voiture non trouvée",
        });
      }

      // Verify car belongs to user
      if (car.owner.toString() !== userId) {
        // Clean up uploaded files if unauthorized
        if (req.files && Array.isArray(req.files)) {
          const fs = require("fs");
          req.files.forEach((file: Express.Multer.File) => {
            if (fs.existsSync(file.path)) {
              try {
                fs.unlinkSync(file.path);
              } catch (err) {
                console.error("Error deleting file:", err);
              }
            }
          });
        }
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de modifier cette voiture",
        });
      }

      // Prepare update data
      let updateData: any = {};
      const fs = require("fs");
      const path = require("path");

      // Handle image updates
      let finalImages: string[] = [];

      // Parse imagesToDelete and existingImages from FormData
      let imagesToDelete: string[] = [];
      let existingImages: string[] = [];

      if (req.body.imagesToDelete) {
        try {
          imagesToDelete = typeof req.body.imagesToDelete === 'string' 
            ? JSON.parse(req.body.imagesToDelete) 
            : req.body.imagesToDelete;
        } catch (err) {
          console.error("Error parsing imagesToDelete:", err);
        }
      }

      if (req.body.existingImages) {
        try {
          existingImages = typeof req.body.existingImages === 'string'
            ? JSON.parse(req.body.existingImages)
            : req.body.existingImages;
        } catch (err) {
          console.error("Error parsing existingImages:", err);
        }
      }

      // Delete images marked for deletion
      if (imagesToDelete && imagesToDelete.length > 0) {
        imagesToDelete.forEach((imagePath: string) => {
          // Handle both absolute and relative paths
          const relativeImagePath = imagePath.startsWith('/uploads/') 
            ? imagePath.substring('/uploads/'.length) 
            : imagePath.replace(/^\/uploads\//, '');
          const fullPath = path.join(process.cwd(), 'uploads', relativeImagePath);
          
          if (fs.existsSync(fullPath)) {
            try {
              fs.unlinkSync(fullPath);
              console.log("Deleted image:", fullPath);
            } catch (err) {
              console.error("Error deleting image file:", err);
            }
          }
        });
      }

      // Start with existing images to keep
      finalImages = [...existingImages];

      // Add new images if uploaded
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        const newImagePaths = (req.files as Express.Multer.File[]).map(
          (file) => `/uploads/images/${file.filename}`
        );
        finalImages = [...finalImages, ...newImagePaths];
      }

      // If no images are being managed, keep existing images
      if (finalImages.length === 0 && car.images && car.images.length > 0) {
        finalImages = car.images;
      }

      // Update images array
      if (req.files || imagesToDelete.length > 0 || existingImages.length > 0) {
        updateData.images = finalImages;
      }

      // Validate and add text fields
      const { error, value } = updateCarSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        // Clean up uploaded files if validation fails
        if (req.files && Array.isArray(req.files)) {
          const fs = require("fs");
          req.files.forEach((file: Express.Multer.File) => {
            if (fs.existsSync(file.path)) {
              try {
                fs.unlinkSync(file.path);
              } catch (err) {
                console.error("Error deleting file:", err);
              }
            }
          });
        }
        const errors = error.details.map((detail) => detail.message);
        return res.status(400).json({
          ok: false,
          message: "Erreur de validation",
          errors,
        });
      }

      // Merge text fields with image paths
      updateData = { ...updateData, ...value };

      // Update car (excluding status)
      const updatedCar = await Car.findByIdAndUpdate(
        carId,
        updateData,
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        ok: true,
        message: "Voiture mise à jour avec succès",
        car: updatedCar?.toJSON(),
      });
    } catch (err: any) {
      // Clean up uploaded files on error
      if (req.files && Array.isArray(req.files)) {
        const fs = require("fs");
        req.files.forEach((file: Express.Multer.File) => {
          if (fs.existsSync(file.path)) {
            try {
              fs.unlinkSync(file.path);
            } catch (error) {
              console.error("Error deleting file:", error);
            }
          }
        });
      }
      console.error("Error updating car:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Delete car endpoint
router.delete(
  "/delete/:id",
  authenticateToken,
  requireSeller,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const carId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      // Find car and verify ownership
      const car = await Car.findById(carId);
      if (!car) {
        return res.status(404).json({
          ok: false,
          message: "Voiture non trouvée",
        });
      }

      // Verify car belongs to user
      if (car.owner.toString() !== userId) {
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de supprimer cette voiture",
        });
      }

      // Delete images from filesystem
      if (car.images && car.images.length > 0) {
        const fs = require("fs");
        const path = require("path");
        car.images.forEach((imagePath: string) => {
          const fullPath = path.join(process.cwd(), imagePath);
          if (fs.existsSync(fullPath)) {
            try {
              fs.unlinkSync(fullPath);
            } catch (err) {
              console.error("Error deleting image file:", err);
            }
          }
        });
      }

      // Delete car
      await Car.findByIdAndDelete(carId);

      return res.status(200).json({
        ok: true,
        message: "Voiture supprimée avec succès",
      });
    } catch (err: any) {
      console.error("Error deleting car:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

export default router;
