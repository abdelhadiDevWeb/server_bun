import mongoose, { Schema, type InferSchemaType } from "mongoose";

const WorkshopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, unique: true, index: true, lowercase: true },
    adr: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, unique: true, index: true },
    password: { type: String, required: true },
    type: {
      type: String,
      enum: ['paint_vehicle', 'mechanic', 'mechanic_paint_inspector'],
      required: true,
    },
    status: { type: Boolean, default: false },
    verfie: { type: Boolean, default: false },
    certifie: { type: Boolean, default: false },
    price_visit_mec: { type: Number, default: null },
    price_visit_paint: { type: Number, default: null },
  },
  { timestamps: true }
);

WorkshopSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

WorkshopSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    delete ret.password;
    return ret;
  },
});

export type WorkshopDocument = InferSchemaType<typeof WorkshopSchema>;

export const Workshop =
  mongoose.models.Workshop || mongoose.model("Workshop", WorkshopSchema);

