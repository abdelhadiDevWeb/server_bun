import { Router } from "express";
import type { Request, Response } from "express";
import { Car } from "../Models/Car";
import { User } from "../Models/User";
import { authenticateToken, requireSeller } from "../middleware/auth.middleware";
import { uploadMultiple } from "../middleware/upload.middleware";
import { validate, validationSchemas } from "../middleware/validation.middleware";
import { paginateQuery, parsePaginationParams } from "../utils/pagination";
import { CachingService } from "../services/cachingService";
import { logger } from "../utils/logger";
import Joi from "joi";
import mongoose from "mongoose";
import "dotenv/config";

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
  vin: Joi.string()
    .trim()
    .length(17)
    .pattern(/^[A-HJ-NPR-Z0-9]{17}$/)
    .uppercase()
    .optional()
    .messages({
      "string.length": "Le VIN doit contenir exactement 17 caractères",
      "string.pattern.base": "Le VIN contient des caractères invalides",
    }),
  color: Joi.string()
    .trim()
    .max(50)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "La couleur ne peut pas dépasser 50 caractères",
    }),
  ports: Joi.number()
    .integer()
    .min(2)
    .max(6)
    .optional()
    .allow(null, '')
    .messages({
      "number.min": "Le nombre de portes doit être au moins 2",
      "number.max": "Le nombre de portes ne peut pas dépasser 6",
    }),
  boite: Joi.string()
    .valid('manuelle', 'auto', 'semi-auto')
    .optional()
    .allow(null, '')
    .messages({
      "any.only": "La boîte doit être 'manuelle', 'auto' ou 'semi-auto'",
    }),
  type_gaz: Joi.string()
    .valid('diesel', 'gaz', 'essence', 'electrique')
    .optional()
    .allow(null, '')
    .messages({
      "any.only": "Le type de carburant doit être 'diesel', 'gaz', 'essence' ou 'electrique'",
    }),
  type_enegine: Joi.string()
    .trim()
    .max(100)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "Le type de moteur ne peut pas dépasser 100 caractères",
    }),
  description: Joi.string()
    .trim()
    .max(2000)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "La description ne peut pas dépasser 2000 caractères",
    }),
  accident: Joi.boolean()
    .optional()
    .default(false),
  usedby: Joi.string()
    .trim()
    .max(100)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "Le champ 'utilisé par' ne peut pas dépasser 100 caractères",
    }),
  // Status is not sent by user, it's set by admin/system
  // Default will be 'no_proccess' in the model
});

// Function to verify VIN via Auto.dev API
async function verifyVIN(vin: string): Promise<{ valid: boolean; data?: any; error?: string; remark?: string }> {
  try {
    // Load API key from environment
    const apiKey = process.env.API_VIN;
    
    console.log("🔑 API_VIN check:", apiKey ? "Found" : "NOT FOUND");
    console.log("🔑 API_VIN value:", apiKey ? `${apiKey.substring(0, 10)}...` : "undefined");
    
    if (!apiKey) {
      console.error("❌ API_VIN not found in environment variables");
      console.error("❌ Available env vars:", Object.keys(process.env).filter(k => k.includes('VIN') || k.includes('API')));
      return { valid: false, error: "API VIN key not configured. Please check your .env file." };
    }

    // Auto.dev API endpoint with apiKey as query parameter
    const apiUrl = `https://api.auto.dev/vin/${vin}?apiKey=${encodeURIComponent(apiKey)}`;
    
    console.log("🔍 Verifying VIN:", vin);
    console.log("🔗 API URL:", apiUrl.replace(apiKey, '***'));
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Try to get error message from response
      let errorMessage = 'VIN invalide ou non trouvé';
      
      // Handle different HTTP status codes
      if (response.status === 404) {
        errorMessage = 'VIN non trouvé. Ce numéro VIN n\'existe pas.';
      } else if (response.status === 400) {
        errorMessage = 'VIN invalide. Le format du VIN est incorrect.';
      } else if (response.status === 401 || response.status === 403) {
        errorMessage = 'Erreur d\'authentification avec l\'API VIN. Veuillez contacter le support.';
      } else if (response.status >= 500) {
        errorMessage = 'Erreur serveur lors de la vérification du VIN. Veuillez réessayer plus tard.';
      }
      
      try {
        const errorData = await response.json();
        console.error("❌ VIN API Error:", errorData);
        
        // Extract error message from various possible formats
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message && typeof errorData.message === 'string') {
          errorMessage = errorData.message;
        } else if (errorData.error && typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        } else if (errorData.details && typeof errorData.details === 'string') {
          errorMessage = errorData.details;
        } else if (errorData.message && typeof errorData.message === 'object') {
          // If message is an object, extract the error field
          errorMessage = errorData.message.error || errorData.message.message || errorMessage;
        }
      } catch (e) {
        // If response is not JSON, use status text
        try {
          const text = await response.text();
          console.error("❌ VIN API Error (text):", text.substring(0, 200));
          if (text && text.trim().length > 0) {
            errorMessage = text.substring(0, 200);
          }
        } catch (textError) {
          // Keep the default error message based on status code
        }
      }
      return { valid: false, error: errorMessage };
    }

    const data = await response.json();
    console.log("✅ VIN API Response received:", JSON.stringify(data).substring(0, 500));
    
    // Check if response is null, undefined, or empty
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
      console.log("❌ VIN validation failed: No data or empty object");
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Check for error in response (various formats)
    if (data.error) {
      let errorMsg = "VIN non trouvé. Ce numéro VIN n'existe pas.";
      if (typeof data.error === 'string') {
        errorMsg = data.error;
      } else if (typeof data.error === 'object' && data.error.message) {
        errorMsg = typeof data.error.message === 'string' ? data.error.message : "VIN non trouvé. Ce numéro VIN n'existe pas.";
      }
      console.log("❌ VIN validation failed: Error in response:", errorMsg);
      return { valid: false, error: errorMsg };
    }
    
    // Check for error message or status indicating failure
    if (data.message && typeof data.message === 'string') {
      const lowerMessage = data.message.toLowerCase();
      if (lowerMessage.includes('error') || lowerMessage.includes('not found') || lowerMessage.includes('invalid') || lowerMessage.includes('does not exist') || lowerMessage.includes('not available')) {
        console.log("❌ VIN validation failed: Error message found:", data.message);
        return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
      }
    }
    
    // Check for status field indicating failure
    if (data.status && (data.status === 'error' || data.status === 'failed' || data.status === 'not_found' || data.status === 'invalid')) {
      console.log("❌ VIN validation failed: Status indicates failure:", data.status);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Extract essential VIN data - check multiple possible field names
    const make = (data.make || data.manufacturer || data.manufacturerName || '').toString().trim();
    const model = (data.model || data.modelName || '').toString().trim();
    const year = (data.year || data.modelYear || data.manufactureYear || '').toString().trim();
    
    console.log("🔍 VIN Data extracted - make:", make, "model:", model, "year:", year);
    
    // STRICT VALIDATION: VIN must have BOTH make AND model to be considered valid
    // If either is missing or empty, the VIN doesn't exist
    if (!make || make === '' || make === 'null' || make === 'undefined' || !model || model === '' || model === 'null' || model === 'undefined') {
      console.log("❌ VIN validation failed: Missing essential data - make:", make, "model:", model);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Additional validation: check if make/model are meaningful (not just spaces, special chars, or default values)
    if (make.length < 2 || model.length < 2) {
      console.log("❌ VIN validation failed: Make or model too short");
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Check for common invalid/default values that APIs sometimes return
    const invalidValues = ['n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'not available', 'not specified', '-', '--', '---'];
    const makeLower = make.toLowerCase();
    const modelLower = model.toLowerCase();
    
    if (invalidValues.includes(makeLower) || invalidValues.includes(modelLower)) {
      console.log("❌ VIN validation failed: Invalid default values detected - make:", make, "model:", model);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Check if the response looks like an error response (e.g., has error-like structure)
    if (data.code || data.statusCode || (data.message && typeof data.message === 'object')) {
      console.log("❌ VIN validation failed: Response structure suggests error");
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Final check: if we have make and model but they seem to be placeholder values
    // Some APIs return placeholder data even for invalid VINs
    if (make.length > 50 || model.length > 50) {
      console.log("❌ VIN validation failed: Make or model too long (likely placeholder)");
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }

    // Additional validation: Check if the data structure looks valid
    // Some APIs return empty objects or minimal data even for invalid VINs
    const hasValidData = make && model && make.length >= 2 && model.length >= 2;
    
    if (!hasValidData) {
      console.log("❌ VIN validation failed: Data structure invalid - make:", make, "model:", model);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Check if make/model contain only numbers or special characters (invalid)
    // Valid make/model should contain letters
    const makeHasLetters = /[a-zA-Z]/.test(make);
    const modelHasLetters = /[a-zA-Z]/.test(model);
    
    if (!makeHasLetters || !modelHasLetters) {
      console.log("❌ VIN validation failed: Make or model contains no letters - make:", make, "model:", model);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Check if the response has very few fields (likely invalid VIN)
    // Valid VIN responses usually have multiple fields (make, model, year, etc.)
    const dataKeys = Object.keys(data);
    const essentialFields = ['make', 'model', 'manufacturer', 'year', 'modelYear'];
    const hasEssentialFields = essentialFields.some(field => dataKeys.includes(field) && data[field]);
    
    if (!hasEssentialFields && dataKeys.length < 3) {
      console.log("❌ VIN validation failed: Response has too few fields - keys:", dataKeys);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // Final validation before accepting: ensure make and model are not just random strings
    // They should be reasonable length and contain proper characters
    if (make.length < 2 || make.length > 30 || model.length < 2 || model.length > 50) {
      console.log("❌ VIN validation failed: Make or model length out of reasonable range");
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }
    
    // At this point, we have confirmed that make and model exist and are valid
    // Extract useful information for remark from Auto.dev response
    // Auto.dev typically returns: make, model, year, etc.
    // Create a simple remark
    let remark = '';
    if (year && make && model) {
      remark = `${year} ${make} ${model}`;
    } else if (make && model) {
      remark = `${make} ${model}`;
    } else {
      // This should not happen since we validated make and model above
      // But if it does, consider it invalid
      console.log("❌ VIN validation failed: Unable to create remark from data");
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }

    // Final check: if remark is created but seems invalid, reject
    if (!remark || remark.trim().length < 3) {
      console.log("❌ VIN validation failed: Remark is invalid:", remark);
      return { valid: false, error: "VIN non trouvé. Ce numéro VIN n'existe pas." };
    }

    console.log("✅ VIN validation successful - remark:", remark);
    
    // Extract additional details from the API response
    const vinDetails = {
      make: make,
      model: model,
      year: year || null,
      manufacturer: data.manufacturer || make,
      modelYear: data.modelYear || year || null,
      bodyType: data.bodyType || data.body || null,
      engine: data.engine || data.engineType || null,
      transmission: data.transmission || data.transmissionType || null,
      driveType: data.driveType || data.drive || null,
      fuelType: data.fuelType || data.fuel || null,
      doors: data.doors || null,
      seats: data.seats || null,
      color: data.color || null,
      vin: vin,
    };
    
    // VIN is valid, return the data, remark, and details
    return { 
      valid: true, 
      data: data,
      remark: remark,
      details: vinDetails
    };
  } catch (error: any) {
    console.error("Error verifying VIN:", error);
    return { valid: false, error: error.message || "Erreur lors de la vérification du VIN" };
  }
}

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
  async (req: Request, res: Response) => {
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

      // Verify VIN if provided
      let vinData = null;
      let vinRemark = null;
      let status_vin = false;
      const bypassVin = req.body.bypassVin === 'true' || req.body.bypassVin === true;
      
      if (value.vin) {
        const vinResult = await verifyVIN(value.vin.toUpperCase());
        if (vinResult.valid) {
          vinData = vinResult.data;
          vinRemark = vinResult.remark;
          status_vin = true;
        } else {
          // VIN is invalid
          status_vin = false;
          // Only reject if bypass is not requested
          if (!bypassVin) {
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
            
            return res.status(400).json({
              ok: false,
              message: vinResult.error || "VIN invalide",
            });
          }
        }
      }

      // Get image paths
      const imagePaths = (req.files as Express.Multer.File[]).map(
        (file) => `/uploads/images/${file.filename}`
      );

      // Create car - status defaults to 'no_proccess' in model
      const carData: any = {
        ...value,
        images: imagePaths,
        owner: userId,
        status: 'no_proccess', // Explicitly set default status
      };

      // Add VIN and VIN data if provided
      if (value.vin) {
        carData.vin = value.vin.toUpperCase();
        carData.vinData = vinData;
        carData.vinRemark = vinRemark; // Store the remark for display
        carData.status_vin = status_vin; // Set VIN validation status
      } else {
        carData.status_vin = false; // No VIN provided, status is false
      }

      Car.create(carData)
        .then(async (car) => {
          // Invalidate car-related caches after successful creation
          try {
            await CachingService.invalidateCache('cars');
            logger.info({
              carId: car._id?.toString(),
              msg: 'Car created, caches invalidated',
            });
          } catch (cacheError) {
            logger.warn({
              error: cacheError,
              msg: 'Cache invalidation failed after car creation',
            });
          }
          
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

    const { excludeWorkshop } = req.query;

    // If excludeWorkshop is provided, filter out cars that have appointments with this workshop
    if (excludeWorkshop && mongoose.Types.ObjectId.isValid(excludeWorkshop as string)) {
      const { RendezVousWorkshop } = await import("../Models/RendezVousWorkshop");
      const workshopId = new mongoose.Types.ObjectId(excludeWorkshop as string);
      
      // Find all cars that have appointments with this workshop
      const carsWithAppointments = await RendezVousWorkshop.find({
        id_workshop: workshopId,
        id_owner_car: userId,
      })
        .distinct('id_car')
        .lean();

      // Get all user's cars
      const allCars = await Car.find({ owner: userId })
        .sort({ createdAt: -1 })
        .lean();

      // Filter out cars that have appointments with this workshop
      const filteredCars = allCars.filter(car => {
        const carId = car._id?.toString();
        return !carsWithAppointments.some((appointmentCarId: any) => 
          appointmentCarId?.toString() === carId
        );
      });

      return res.status(200).json({
        ok: true,
        cars: filteredCars,
      });
    }

    // If no excludeWorkshop, return all cars with cursor pagination
    const paginationOptions = parsePaginationParams(req.query);
    const result = await paginateQuery(
      Car,
      { owner: userId },
      paginationOptions
    );

    return res.status(200).json({
      ok: true,
      cars: result.data,
      pagination: result.pagination,
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
// Get all cars except those with status 'vendue' (public endpoint) with optional search filters
router.get("/active", async (req: Request, res: Response) => {
  try {
    const { 
      brand, 
      model, 
      maxPrice, 
      minPrice,
      maxKm, 
      minKm,
      minYear,
      maxYear,
      color,
      ports,
      boite,
      type_gaz,
      type_enegine,
      accident,
      usedby
    } = req.query;

    // Build query - exclude cars with status 'vendue'
    const query: any = { status: { $ne: 'vendue' } };

    if (brand && typeof brand === 'string') {
      query.brand = { $regex: brand, $options: 'i' };
    }

    if (model && typeof model === 'string') {
      query.model = { $regex: model, $options: 'i' };
    }

    // Price range
    if (minPrice && typeof minPrice === 'string') {
      const minPriceNum = parseInt(minPrice);
      if (!isNaN(minPriceNum)) {
        query.price = { ...(query.price || {}), $gte: minPriceNum };
      }
    }
    if (maxPrice && typeof maxPrice === 'string') {
      const maxPriceNum = parseInt(maxPrice);
      if (!isNaN(maxPriceNum)) {
        query.price = { ...(query.price || {}), $lte: maxPriceNum };
      }
    }

    // Km range
    if (minKm && typeof minKm === 'string') {
      const minKmNum = parseInt(minKm);
      if (!isNaN(minKmNum)) {
        query.km = { ...(query.km || {}), $gte: minKmNum };
      }
    }
    if (maxKm && typeof maxKm === 'string') {
      const maxKmNum = parseInt(maxKm);
      if (!isNaN(maxKmNum)) {
        query.km = { ...(query.km || {}), $lte: maxKmNum };
      }
    }

    // Year range
    if (minYear && typeof minYear === 'string') {
      const minYearNum = parseInt(minYear);
      if (!isNaN(minYearNum)) {
        query.year = { ...(query.year || {}), $gte: minYearNum };
      }
    }
    if (maxYear && typeof maxYear === 'string') {
      const maxYearNum = parseInt(maxYear);
      if (!isNaN(maxYearNum)) {
        query.year = { ...(query.year || {}), $lte: maxYearNum };
      }
    }

    // Color filter
    if (color && typeof color === 'string') {
      query.color = { $regex: color, $options: 'i' };
    }

    // Ports filter
    if (ports && typeof ports === 'string') {
      const portsNum = parseInt(ports);
      if (!isNaN(portsNum)) {
        query.ports = portsNum;
      }
    }

    // Boite (transmission) filter
    if (boite && typeof boite === 'string' && ['manuelle', 'auto', 'semi-auto'].includes(boite)) {
      query.boite = boite;
    }

    // Type gaz (fuel type) filter
    if (type_gaz && typeof type_gaz === 'string' && ['diesel', 'gaz', 'essence', 'electrique'].includes(type_gaz)) {
      query.type_gaz = type_gaz;
    }

    // Type engine filter
    if (type_enegine && typeof type_enegine === 'string') {
      query.type_enegine = { $regex: type_enegine, $options: 'i' };
    }

    // Accident filter
    if (accident !== undefined) {
      if (accident === 'true' || accident === '1') {
        query.accident = true;
      } else if (accident === 'false' || accident === '0') {
        query.accident = false;
      }
    }

    // Usedby filter
    if (usedby && typeof usedby === 'string') {
      query.usedby = { $regex: usedby, $options: 'i' };
    }

    // Parse pagination parameters
    const paginationOptions = parsePaginationParams(req.query);
    paginationOptions.maxLimit = 50; // Ensure reasonable limits for public API
    
    // Check if this is a simple query that can be cached
    const isSimpleQuery = Object.keys(query).length <= 1; // Only status filter
    const page = Math.max(1, Math.floor((paginationOptions.cursor ? 0 : 0) / (paginationOptions.limit || 20)) + 1);
    const limit = paginationOptions.limit || 20;
    
    if (isSimpleQuery && !paginationOptions.cursor) {
      // Use cached version for simple queries (no filters, first page)
      try {
        const cachedResult = await CachingService.getActiveCars({}, page, limit);
        
        // Convert to cursor pagination format for consistency
        const hasNextPage = cachedResult.cars.length === limit;
        const nextCursor = hasNextPage && cachedResult.cars.length > 0 
          ? Buffer.from(cachedResult.cars[cachedResult.cars.length - 1].createdAt).toString('base64')
          : null;
        
        logger.info({
          fromCache: cachedResult.fromCache,
          carCount: cachedResult.cars.length,
          totalCount: cachedResult.totalCount,
          msg: 'Active cars query served',
        });
        
        return res.status(200).json({
          ok: true,
          cars: cachedResult.cars,
          pagination: {
            hasNextPage,
            hasPreviousPage: page > 1,
            nextCursor,
            previousCursor: null,
            totalCount: cachedResult.totalCount,
          },
          fromCache: cachedResult.fromCache,
        });
      } catch (cacheError) {
        logger.warn({
          error: cacheError,
          msg: 'Cache failed, falling back to database',
        });
        // Fall through to database query
      }
    }
    
    // Apply cursor-based pagination for complex queries or cache miss
    const result = await paginateQuery(
      Car,
      query,
      paginationOptions,
      { path: 'owner', select: 'firstName lastName email phone certifie' }
    );

    logger.info({
      fromCache: false,
      carCount: result.data.length,
      hasNextPage: result.pagination.hasNextPage,
      msg: 'Active cars query served from database',
    });

    return res.status(200).json({
      ok: true,
      cars: result.data.map((car: any) => ({
        ...car,
        id: car._id?.toString(),
      })),
      pagination: result.pagination,
      fromCache: false,
    });
  } catch (err: any) {
    console.error("Get active cars error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Public endpoint to check car verification status (for QR code scanning)
router.get("/verify/:id", async (req: Request, res: Response) => {
  try {
    const carId = req.params.id;
    const car = await Car.findById(carId)
      .populate('owner', 'firstName lastName email phone certifie')
      .lean();

    if (!car) {
      return res.status(404).json({
        ok: false,
        verified: false,
        message: "Voiture non trouvée",
      });
    }

    // Check if car has been verified (status is 'actif' and has finished appointments)
    const { RendezVousWorkshop } = await import("../Models/RendezVousWorkshop");
    const finishedAppointments = await RendezVousWorkshop.find({
      id_car: carId,
      status: 'finish'
    }).lean();

    const isVerified = car.status === 'actif' && finishedAppointments.length > 0;

    return res.status(200).json({
      ok: true,
      verified: isVerified,
      car: {
        _id: car._id,
        id: car._id?.toString(),
        brand: car.brand,
        model: car.model,
        year: car.year,
        status: car.status,
      },
      message: isVerified ? "Véhicule vérifié" : "Véhicule non vérifié",
    });
  } catch (err: any) {
    console.error("Error checking car verification:", err);
    return res.status(500).json({
      ok: false,
      verified: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const carId = req.params.id;
    const car = await Car.findById(carId)
      .populate('owner', 'firstName lastName email phone certifie')
      .select('+qr')
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
  color: Joi.string()
    .trim()
    .max(50)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "La couleur ne peut pas dépasser 50 caractères",
    }),
  ports: Joi.number()
    .integer()
    .min(2)
    .max(6)
    .optional()
    .allow(null, '')
    .messages({
      "number.min": "Le nombre de portes doit être au moins 2",
      "number.max": "Le nombre de portes ne peut pas dépasser 6",
    }),
  boite: Joi.string()
    .valid('manuelle', 'auto', 'semi-auto')
    .optional()
    .allow(null, '')
    .messages({
      "any.only": "La boîte doit être 'manuelle', 'auto' ou 'semi-auto'",
    }),
  type_gaz: Joi.string()
    .valid('diesel', 'gaz', 'essence', 'electrique')
    .optional()
    .allow(null, '')
    .messages({
      "any.only": "Le type de carburant doit être 'diesel', 'gaz', 'essence' ou 'electrique'",
    }),
  type_enegine: Joi.string()
    .trim()
    .max(100)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "Le type de moteur ne peut pas dépasser 100 caractères",
    }),
  description: Joi.string()
    .trim()
    .max(2000)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "La description ne peut pas dépasser 2000 caractères",
    }),
  accident: Joi.boolean()
    .optional()
    .default(false),
  usedby: Joi.string()
    .trim()
    .max(100)
    .optional()
    .allow(null, '')
    .messages({
      "string.max": "Le champ 'utilisé par' ne peut pas dépasser 100 caractères",
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

// Verify VIN endpoint
router.post("/verify-vin", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const { vin } = req.body;

    if (!vin || typeof vin !== 'string') {
      return res.status(400).json({
        ok: false,
        message: "VIN manquant",
      });
    }

    if (vin.length !== 17) {
      return res.status(400).json({
        ok: false,
        message: "Le VIN doit contenir exactement 17 caractères",
      });
    }

    const vinResult = await verifyVIN(vin.toUpperCase());
    
    if (!vinResult.valid) {
      return res.status(400).json({
        ok: false,
        valid: false,
        message: vinResult.error || "VIN invalide",
      });
    }

    return res.status(200).json({
      ok: true,
      valid: true,
      message: "VIN valide",
      remark: vinResult.remark || "VIN vérifié",
      data: vinResult.data,
      details: vinResult.details || null,
    });
  } catch (error: any) {
    console.error("Error verifying VIN:", error);
    return res.status(500).json({
      ok: false,
      valid: false,
      message: "Erreur lors de la vérification du VIN",
      error: error.message,
    });
  }
});

export default router;
