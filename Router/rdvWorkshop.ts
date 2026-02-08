import { Router } from "express";
import type { Request, Response } from "express";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { Notification } from "../Models/Notification";
import { authenticateToken } from "../middleware/auth.middleware";
import { Car } from "../Models/Car";
import Joi from "joi";
import mongoose from "mongoose";

const router = Router();

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
    .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .required()
    .messages({
      "any.required": "L'heure est requise",
      "string.pattern.base": "Format d'heure invalide (HH:MM)",
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

      const unavailableTimes = existingAppointments
        .map(apt => apt.time)
        .filter((t, index, self) => self.indexOf(t) === index) // Remove duplicates
        .sort();

      // Generate all possible time slots (8:00 to 23:45 in 15-minute intervals)
      const allTimeSlots: string[] = [];
      for (let hour = 8; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 15) {
          const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          allTimeSlots.push(timeString);
        }
      }
      // Note: This generates slots from 8:00 to 23:45 (64 slots total)

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

      // Check if the requested time is already taken
      const isTimeTaken = existingAppointments.some(apt => apt.time === time);
      
      if (isTimeTaken) {
        // Get all unavailable times for this date
        const unavailableTimes = existingAppointments
          .map(apt => apt.time)
          .filter((t, index, self) => self.indexOf(t) === index) // Remove duplicates
          .sort();

        return res.status(400).json({
          ok: false,
          message: "Ce créneau horaire n'est pas disponible",
          unavailableTimes,
        });
      }

      // Create appointment
      const appointment = new RendezVousWorkshop({
        id_workshop,
        id_owner_car: userId,
        id_car,
        date: new Date(date),
        time,
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
        .populate('id_owner_car', 'firstName lastName email phone')
        .populate('id_car', 'brand model year images')
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
      if (!['en_attente', 'accepted', 'refused'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Le statut doit être 'en_attente', 'accepted' ou 'refused'",
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

      appointment.status = status;
      await appointment.save();

      // Create notification for user based on status
      const { Notification } = await import("../Models/Notification");
      let notificationMessage = '';
      let notificationType = 'rdv_workshop';

      if (status === 'accepted') {
        notificationMessage = `Votre rendez-vous du ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} a été accepté`;
        notificationType = 'done_rdv_workshop';
      } else if (status === 'refused') {
        notificationMessage = `Votre rendez-vous du ${new Date(appointment.date).toLocaleDateString('fr-FR')} à ${appointment.time} a été refusé`;
        notificationType = 'cancel_rdv_workshop';
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
      }

      const statusMessages: Record<string, string> = {
        'en_attente': "Rendez-vous remis en attente",
        'accepted': "Rendez-vous accepté",
        'refused': "Rendez-vous refusé",
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

export default router;
