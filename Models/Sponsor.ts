import mongoose, { Schema, type InferSchemaType } from "mongoose";

const SponsorSchema = new Schema(
  {
    id_car: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Car",
      index: true,
    },
    id_owner: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
      index: true,
    },
    start_date: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    end_date: {
      type: Date,
      required: true,
    },
    duration: {
      // Duration in days (integer >= 1).
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      // Price paid for the sponsorship. Defaults to 0 so existing rows that
      // pre-date this field still validate on read.
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      // true  = active sponsorship (within the date window)
      // false = cancelled or expired
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Common access patterns
SponsorSchema.index({ id_owner: 1, status: 1 });
SponsorSchema.index({ id_car: 1, status: 1 });
SponsorSchema.index({ end_date: 1 });

SponsorSchema.virtual("id").get(function (this: { _id: mongoose.Types.ObjectId }) {
  return this._id?.toString();
});

SponsorSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete (ret as { _id?: unknown })._id;
    return ret;
  },
});

export type SponsorDocument = InferSchemaType<typeof SponsorSchema>;

export const Sponsor =
  mongoose.models.Sponsor || mongoose.model("Sponsor", SponsorSchema);
