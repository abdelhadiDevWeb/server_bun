import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ImageSchema = new Schema(
  {
    // owner id (user/workshop). Keeping as string to support both until you decide a strict relation.
    i_owner: { type: String, required: true, index: true },
    image: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

ImageSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

ImageSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type ImageDocument = InferSchemaType<typeof ImageSchema>;

export const Image =
  mongoose.models.Image || mongoose.model("Image", ImageSchema);

