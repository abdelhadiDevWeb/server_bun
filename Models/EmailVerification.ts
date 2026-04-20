import mongoose, { Schema } from "mongoose";

const EmailVerificationSchema = new Schema(
  {
    email: { type: String, required: true, index: true, lowercase: true, trim: true },
    code: { 
      type: String, 
      required: true, 
      trim: true,
      validate: {
        validator: function(v: string) {
          return /^\d{6}$/.test(v); // Exactly 6 digits
        },
        message: 'Code must be exactly 6 digits'
      }
    },
    type: { type: String, required: true, enum: ["user", "workshop"] },
    purpose: {
      type: String,
      required: true,
      enum: ["email_verification", "password_reset"],
      default: "email_verification",
      index: true,
    },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 15 * 60 * 1000) }, // 15 minutes
  },
  { timestamps: true }
);

// Auto-delete expired codes
EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailVerification =
  mongoose.models.EmailVerification || mongoose.model("EmailVerification", EmailVerificationSchema);
