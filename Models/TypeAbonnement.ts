import mongoose, { Schema, type InferSchemaType } from "mongoose";

const TypeAbonnementSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    time: { type: Number, required: true }, // Duration in days
    price: { type: Number, required: true },
  },
  { timestamps: true }
);

TypeAbonnementSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

TypeAbonnementSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type TypeAbonnementDocument = InferSchemaType<typeof TypeAbonnementSchema>;

export const TypeAbonnement =
  mongoose.models.TypeAbonnement || mongoose.model("TypeAbonnement", TypeAbonnementSchema);
