import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * AbonnementSponsor = a purchasable "sponsorship plan".
 * Admins manage these via /api/admin/sponsor-plans, users read them via
 * /api/sponsor/plans when creating a new sponsorship.
 */
const AbonnementSponsorSchema = new Schema(
  {
    duration: {
      // Duration in days (integer >= 1).
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      // Price in DA (>= 0). Float allowed in case of fractional currency.
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

AbonnementSponsorSchema.index({ duration: 1 });

AbonnementSponsorSchema.virtual("id").get(function (this: { _id: mongoose.Types.ObjectId }) {
  return this._id?.toString();
});

AbonnementSponsorSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete (ret as { _id?: unknown })._id;
    return ret;
  },
});

export type AbonnementSponsorDocument = InferSchemaType<typeof AbonnementSponsorSchema>;

export const AbonnementSponsor =
  mongoose.models.AbonnementSponsor ||
  mongoose.model("AbonnementSponsor", AbonnementSponsorSchema);
