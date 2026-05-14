import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ColorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true }
);

ColorSchema.index({ name: 1 }, { unique: true });

ColorSchema.virtual("id").get(function (this: { _id: mongoose.Types.ObjectId }) {
  return this._id?.toString();
});

ColorSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete (ret as { _id?: unknown })._id;
    return ret;
  },
});

export type ColorDocument = InferSchemaType<typeof ColorSchema>;

export const Color =
  mongoose.models.Color || mongoose.model("Color", ColorSchema);
