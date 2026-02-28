import { Router } from "express";
import type { Request, Response } from "express";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { Notification } from "../Models/Notification";
import { authenticateToken } from "../middleware/auth.middleware";
import { Car } from "../Models/Car";
import Joi from "joi";
import mongoose from "mongoose";
import { uploadRdvImagesMultiple, uploadRdvPdfSingle } from "../middleware/upload.middleware";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";

const router = Router();

// Utility function to normalize time to 30-minute intervals (round down to nearest 30 minutes)
const normalizeTime = (timeStr: string): string => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  // Round down to nearest 30 minutes
  const normalizedMinutes = minutes < 30 ? 0 : 30;
  return `${hours.toString().padStart(2, '0')}:${normalizedMinutes.toString().padStart(2, '0')}`;
};

// Validation schema for appointment creation
const createRdvSchema = Joi.object({
  id_workshop: Joi.string().required().messages({
    "any.required": "L'atelier est requis",
  }),
  id_car: Joi.string().required().messages({
    "any.required": "La voiture est requise",
  }),
  date: Joi.date().required().messages({
    "any.required": "La date est requise",
    "date.base": "Format de date invalide",
  }),
  time: Joi.string()
    .pattern(/^([0-1]?[0-9]|2[0-3]):(00|30)$/)
    .required()
    .messages({
      "any.required": "L'heure est requise",
      "string.pattern.base": "Format d'heure invalide. Les heures doivent être en intervalles de 30 minutes (ex: 8:00, 8:30, 9:00)",
    }),
});

// Get available time slots for a specific date
router.get(
  "/available-times",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id_workshop, date } = req.query;

      if (!id_workshop || !date) {
        return res.status(400).json({
          ok: false,
          message: "L'atelier et la date sont requis",
        });
      }

      const appointmentDate = new Date(date as string);
      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all appointments for this date
      const existingAppointments = await RendezVousWorkshop.find({
        id_workshop,
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
        status: { $in: ['en_attente', 'accepted'] }, // Only check pending and accepted
      }).lean();

      // Normalize times to 30-minute intervals
      const unavailableTimes = existingAppointments
        .map(apt => normalizeTime(apt.time))
        .filter((t, index, self) => self.indexOf(t) === index) // Remove duplicates
        .sort();

      // Generate all possible time slots (8:00 to 23:30 in 30-minute intervals)
      const allTimeSlots: string[] = [];
      for (let hour = 8; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          allTimeSlots.push(timeString);
        }
      }
      // Note: This generates slots from 8:00 to 23:30 (32 slots total)

      const availableTimes = allTimeSlots.filter(time => !unavailableTimes.includes(time));

      return res.status(200).json({
        ok: true,
        availableTimes,
        unavailableTimes,
        allTimeSlots,
      });
    } catch (err: any) {
      console.error("Get available times error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Create appointment
router.post(
  "/create",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || userType !== 'user') {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié ou type invalide",
        });
      }

      // Validate input
      const { error, value } = createRdvSchema.validate(req.body, {
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

      const { id_workshop, id_car, date, time } = value;

      // Verify car belongs to user
      const car = await Car.findById(id_car);
      if (!car) {
        return res.status(404).json({
          ok: false,
          message: "Voiture non trouvée",
        });
      }

      if (car.owner.toString() !== userId) {
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de créer un rendez-vous pour cette voiture",
        });
      }

      // Check if time slot is available
      const appointmentDate = new Date(date);
      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingAppointments = await RendezVousWorkshop.find({
        id_workshop,
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
        status: { $in: ['en_attente', 'accepted'] }, // Only check pending and accepted appointments
      }).lean();

      // Normalize the requested time
      const normalizedTime = normalizeTime(time);

      // Check if the requested time is already taken (compare normalized times)
      const isTimeTaken = existingAppointments.some(apt => normalizeTime(apt.time) === normalizedTime);
      
      if (isTimeTaken) {
        // Get all unavailable times for this date (normalized)
        const unavailableTimes = existingAppointments
          .map(apt => normalizeTime(apt.time))
          .filter((t, index, self) => self.indexOf(t) === index) // Remove duplicates
          .sort();

        return res.status(400).json({
          ok: false,
          message: "Ce créneau horaire n'est pas disponible",
          unavailableTimes,
        });
      }

      // Create appointment with normalized time
      const appointment = new RendezVousWorkshop({
        id_workshop,
        id_owner_car: userId,
        id_car,
        date: new Date(date),
        time: normalizedTime, // Use normalized time (30-minute interval)
        status: 'en_attente',
      });

      await appointment.save();

      // Create notification
      const notification = new Notification({
        id_sender: userId,
        id_receiver: id_workshop,
        message: `Nouveau rendez-vous demandé pour le ${new Date(date).toLocaleDateString('fr-FR')} à ${time}`,
        type: 'rdv_workshop',
        is_read: false,
      });

      await notification.save();

      // Emit socket event to workshop
      const io = (global as any).io;
      if (io) {
        const appointmentData = {
          appointment: appointment.toJSON(),
          notification: notification.toJSON(),
        };
        io.to(`workshop_${id_workshop}`).emit('new_appointment', appointmentData);
        console.log(`📢 Socket notification sent to workshop_${id_workshop}`);
      }

      return res.status(201).json({
        ok: true,
        message: "Rendez-vous créé avec succès",
        appointment: appointment.toJSON(),
        notification: notification.toJSON(),
      });
    } catch (err: any) {
      console.error("Create appointment error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Get user's appointments
router.get(
  "/my-appointments",
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

      // Convert userId to ObjectId if needed
      const userIdObjectId = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      console.log('🔍 Fetching appointments for user:', userId, 'as ObjectId:', userIdObjectId);

      const appointments = await RendezVousWorkshop.find({ id_owner_car: userIdObjectId })
        .populate('id_workshop', 'name email phone adr')
        .populate('id_car', 'brand model year')
        .sort({ date: -1, time: -1 })
        .lean();

      console.log('📋 Found appointments:', appointments.length);

      return res.status(200).json({
        ok: true,
        appointments: appointments.map(apt => ({
          ...apt,
          id: apt._id?.toString(),
        })),
      });
    } catch (err: any) {
      console.error("Get appointments error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Get appointments for a specific car (public endpoint)
router.get(
  "/car/:carId",
  async (req: Request, res: Response) => {
    try {
      const { carId } = req.params;

      if (!carId) {
        return res.status(400).json({
          ok: false,
          message: "ID de voiture requis",
        });
      }

      const carIdObjectId = mongoose.Types.ObjectId.isValid(carId) 
        ? new mongoose.Types.ObjectId(carId) 
        : carId;

      const appointments = await RendezVousWorkshop.find({ 
        id_car: carIdObjectId,
        status: 'finish' // Only return finished appointments
      })
        .populate('id_workshop', 'name email phone adr certifie')
        .populate('id_car', 'brand model year')
        .sort({ date: -1, time: -1 })
        .lean();

      return res.status(200).json({
        ok: true,
        appointments: appointments.map(apt => ({
          ...apt,
          id: apt._id?.toString(),
        })),
      });
    } catch (err: any) {
      console.error("Get car appointments error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Get workshop's appointments
router.get(
  "/workshop-appointments",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || userType !== 'workshop') {
        return res.status(401).json({
          ok: false,
          message: "Atelier non authentifié",
        });
      }

      const appointments = await RendezVousWorkshop.find({ id_workshop: userId })
        .populate('id_owner_car', 'firstName lastName email phone certifie')
        .populate('id_car', 'brand model year images qr _id')
        .sort({ date: -1, time: -1 })
        .lean();

      return res.status(200).json({
        ok: true,
        appointments: appointments.map(apt => ({
          ...apt,
          id: apt._id?.toString(),
        })),
      });
    } catch (err: any) {
      console.error("Get workshop appointments error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Update appointment status
router.put(
  "/:id/status",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;
      const appointmentId = req.params.id;
      const { status } = req.body;

      if (!userId || userType !== 'workshop') {
        return res.status(401).json({
          ok: false,
          message: "Atelier non authentifié",
        });
      }

      // Validate status
      if (!['en_attente', 'accepted', 'refused', 'en_cours', 'finish'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Le statut doit être 'en_attente', 'accepted', 'refused', 'en_cours' ou 'finish'",
        });
      }

      const appointment = await RendezVousWorkshop.findById(appointmentId);

      if (!appointment) {
        return res.status(404).json({
          ok: false,
          message: "Rendez-vous non trouvé",
        });
      }

      // Verify appointment belongs to workshop
      if (appointment.id_workshop.toString() !== userId) {
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de modifier ce rendez-vous",
        });
      }

      const oldStatus = appointment.status;
      appointment.status = status;
      await appointment.save();

      // If status changed to 'finish', update car status to 'actif' and generate QR code
      if (status === 'finish' && oldStatus !== 'finish') {
        const car = await Car.findById(appointment.id_car);
        if (car) {
          car.status = 'actif';
          
          // Generate QR code URL
          const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
          const qrUrl = `${baseUrl}/verify-car/${car._id.toString()}`;
          
          // Generate QR code as data URL
          try {
            const qrCodeDataUrl = await QRCode.toDataURL(qrUrl);
            
            // Save QR code data URL to car
            car.qr = qrCodeDataUrl;
          } catch (qrError) {
            console.error("Error generating QR code:", qrError);
            // Continue even if QR code generation fails
          }
          
          await car.save();
        }
      }

      // Create notification for user based on status
      let notificationMessage = '';
      let notificationType = 'rdv_workshop';

      if (status === 'accepted') {
        notificationMessage = `Votre rendez-vous du ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} a été accepté`;
        notificationType = 'done_rdv_workshop';
      } else if (status === 'refused') {
        notificationMessage = `Votre rendez-vous du ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} a été refusé`;
        notificationType = 'cancel_rdv_workshop';
      } else if (status === 'en_cours') {
        notificationMessage = `La vérification de votre véhicule pour le rendez-vous du ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} a commencé`;
        notificationType = 'rdv_workshop';
      } else if (status === 'finish') {
        notificationMessage = `La vérification de votre véhicule pour le rendez-vous du ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} est terminée. Votre véhicule est maintenant actif.`;
        notificationType = 'done_rdv_workshop';
      }

      if (notificationMessage) {
        const notification = new Notification({
          id_sender: userId,
          id_receiver: appointment.id_owner_car,
          message: notificationMessage,
          type: notificationType,
          is_read: false,
        });
        await notification.save();

        // Emit socket event to user
        const io = (global as any).io;
        if (io) {
          const notificationData = {
            notification: notification.toJSON(),
            appointment: appointment.toJSON(),
          };
          io.to(`user_${appointment.id_owner_car.toString()}`).emit('new_notification', notificationData);
          console.log(`📢 Socket notification sent to user_${appointment.id_owner_car.toString()}`);
        }
      }

      const statusMessages: Record<string, string> = {
        'en_attente': "Rendez-vous remis en attente",
        'accepted': "Rendez-vous accepté",
        'refused': "Rendez-vous refusé",
        'en_cours': "Vérification en cours",
        'finish': "Vérification terminée",
      };

      return res.status(200).json({
        ok: true,
        message: statusMessages[status] || "Statut mis à jour",
        appointment: appointment.toJSON(),
      });
    } catch (err: any) {
      console.error("Update appointment status error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Upload images for appointment
router.post(
  "/:id/images",
  authenticateToken,
  uploadRdvImagesMultiple,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;
      const appointmentId = req.params.id;

      if (!userId || userType !== 'workshop') {
        // Clean up uploaded files if unauthorized
        if (req.files && Array.isArray(req.files)) {
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
          message: "Atelier non authentifié",
        });
      }

      const appointment = await RendezVousWorkshop.findById(appointmentId);

      if (!appointment) {
        // Clean up uploaded files
        if (req.files && Array.isArray(req.files)) {
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
          message: "Rendez-vous non trouvé",
        });
      }

      // Verify appointment belongs to workshop
      if (appointment.id_workshop.toString() !== userId) {
        // Clean up uploaded files
        if (req.files && Array.isArray(req.files)) {
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
          message: "Vous n'avez pas le droit de modifier ce rendez-vous",
        });
      }

      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({
          ok: false,
          message: "Aucune image fournie",
        });
      }

      // Add new images to existing ones
      const newImagePaths = (req.files as Express.Multer.File[]).map(
        (file) => `/uploads/rdv_images/${file.filename}`
      );

      if (!appointment.images) {
        appointment.images = [];
      }
      appointment.images = [...appointment.images, ...newImagePaths];
      await appointment.save();

      return res.status(200).json({
        ok: true,
        message: "Images uploadées avec succès",
        appointment: appointment.toJSON(),
      });
    } catch (err: any) {
      // Clean up uploaded files on error
      if (req.files && Array.isArray(req.files)) {
        req.files.forEach((file: Express.Multer.File) => {
          if (fs.existsSync(file.path)) {
            try {
              fs.unlinkSync(file.path);
            } catch (deleteErr) {
              console.error("Error deleting file:", deleteErr);
            }
          }
        });
      }
      console.error("Upload images error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Upload PDF report for appointment
router.post(
  "/:id/pdf",
  authenticateToken,
  uploadRdvPdfSingle,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;
      const appointmentId = req.params.id;

      if (!userId || userType !== 'workshop') {
        // Clean up uploaded file if unauthorized
        if (req.file) {
          if (fs.existsSync(req.file.path)) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (err) {
              console.error("Error deleting file:", err);
            }
          }
        }
        return res.status(401).json({
          ok: false,
          message: "Atelier non authentifié",
        });
      }

      const appointment = await RendezVousWorkshop.findById(appointmentId);

      if (!appointment) {
        // Clean up uploaded file
        if (req.file) {
          if (fs.existsSync(req.file.path)) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (err) {
              console.error("Error deleting file:", err);
            }
          }
        }
        return res.status(404).json({
          ok: false,
          message: "Rendez-vous non trouvé",
        });
      }

      // Verify appointment belongs to workshop
      if (appointment.id_workshop.toString() !== userId) {
        // Clean up uploaded file
        if (req.file) {
          if (fs.existsSync(req.file.path)) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (err) {
              console.error("Error deleting file:", err);
            }
          }
        }
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de modifier ce rendez-vous",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "Aucun fichier PDF fourni",
        });
      }

      // Delete old PDF if exists
      if (appointment.rapport_pdf) {
        const oldPdfPath = appointment.rapport_pdf;
        const relativePdfPath = oldPdfPath.startsWith('/uploads/rdv_pdf/')
          ? oldPdfPath.substring('/uploads/rdv_pdf/'.length)
          : oldPdfPath.replace(/^\/uploads\/rdv_pdf\//, '');
        const fullPath = path.join(process.cwd(), 'uploads', 'rdv_pdf', relativePdfPath);
        
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch (err) {
            console.error("Error deleting old PDF file:", err);
          }
        }
      }

      // Update PDF path
      appointment.rapport_pdf = `/uploads/rdv_pdf/${req.file.filename}`;
      await appointment.save();

      return res.status(200).json({
        ok: true,
        message: "Rapport PDF uploadé avec succès",
        appointment: appointment.toJSON(),
      });
    } catch (err: any) {
      // Clean up uploaded file on error
      if (req.file) {
        if (fs.existsSync(req.file.path)) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (deleteErr) {
            console.error("Error deleting file:", deleteErr);
          }
        }
      }
      console.error("Upload PDF error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Delete image from appointment
router.delete(
  "/:id/images/:imageIndex",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;
      const appointmentId = req.params.id;
      const imageIndex = parseInt(req.params.imageIndex);

      if (!userId || userType !== 'workshop') {
        return res.status(401).json({
          ok: false,
          message: "Atelier non authentifié",
        });
      }

      const appointment = await RendezVousWorkshop.findById(appointmentId);

      if (!appointment) {
        return res.status(404).json({
          ok: false,
          message: "Rendez-vous non trouvé",
        });
      }

      // Verify appointment belongs to workshop
      if (appointment.id_workshop.toString() !== userId) {
        return res.status(403).json({
          ok: false,
          message: "Vous n'avez pas le droit de modifier ce rendez-vous",
        });
      }

      if (!appointment.images || imageIndex < 0 || imageIndex >= appointment.images.length) {
        return res.status(400).json({
          ok: false,
          message: "Index d'image invalide",
        });
      }

      // Delete image file
      const imagePath = appointment.images[imageIndex];
      const relativeImagePath = imagePath.startsWith('/uploads/rdv_images/')
        ? imagePath.substring('/uploads/rdv_images/'.length)
        : imagePath.replace(/^\/uploads\/rdv_images\//, '');
      const fullPath = path.join(process.cwd(), 'uploads', 'rdv_images', relativeImagePath);

      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          console.error("Error deleting image file:", err);
        }
      }

      // Remove image from array
      appointment.images.splice(imageIndex, 1);
      await appointment.save();

      return res.status(200).json({
        ok: true,
        message: "Image supprimée avec succès",
        appointment: appointment.toJSON(),
      });
    } catch (err: any) {
      console.error("Delete image error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Check and delete expired appointments for a seller
router.post(
  "/check-expired-seller",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || userType !== 'user') {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié ou non autorisé",
        });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find expired appointments for this user
      const expiredAppointments = await RendezVousWorkshop.find({
        id_owner_car: userId,
        status: { $in: ['en_attente', 'accepted'] },
        date: { $lt: today },
      })
        .populate('id_workshop', 'name _id')
        .populate('id_car', 'brand model year')
        .lean();

      if (expiredAppointments.length === 0) {
        return res.status(200).json({
          ok: true,
          deletedCount: 0,
          deletedAppointments: [],
          message: "Aucun rendez-vous expiré trouvé",
        });
      }

      const deletedAppointments: any[] = [];
      const io = (global as any).io;

      // Delete each expired appointment and create notification for workshop
      for (const appointment of expiredAppointments) {
        const workshopId = (appointment.id_workshop as any)?._id;
        const workshopName = (appointment.id_workshop as any)?.name || 'Atelier';
        const carInfo = appointment.id_car as any;
        const carName = carInfo ? `${carInfo.brand} ${carInfo.model} ${carInfo.year}` : 'véhicule';

        // Create notification for workshop
        if (workshopId) {
          const notification = new Notification({
            id_sender: userId,
            id_receiver: workshopId,
            message: `Le rendez-vous pour ${carName} prévu le ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} a été automatiquement annulé car la date est passée.`,
            type: 'cancel_rdv_workshop',
            is_read: false,
          });
          await notification.save();

          // Send notification via Socket.IO
          if (io) {
            io.to(`workshop_${workshopId.toString()}`).emit('new_notification', {
              id: notification._id.toString(),
              id_sender: userId,
              message: notification.message,
              type: notification.type,
              is_read: false,
              createdAt: notification.createdAt,
            });
            console.log(`📢 Socket notification sent to workshop_${workshopId.toString()}`);
          }
        }

        // Delete the appointment
        await RendezVousWorkshop.deleteOne({ _id: appointment._id });

        deletedAppointments.push({
          id: appointment._id?.toString(),
          date: appointment.date,
          time: appointment.time,
          workshopName,
          carName,
        });
      }

      console.log(`✅ Deleted ${deletedAppointments.length} expired appointment(s) for user ${userId}`);

      return res.status(200).json({
        ok: true,
        deletedCount: deletedAppointments.length,
        deletedAppointments,
        message: `${deletedAppointments.length} rendez-vous expiré(s) supprimé(s)`,
      });
    } catch (err: any) {
      console.error("Check expired appointments error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

export default router;
