import mongoose, { Schema, type InferSchemaType } from "mongoose";

const UserImageSchema = new Schema(
  {
    id_owner: { 
      type: Schema.Types.ObjectId, 
      required: true, 
      ref: 'User',
      index: true 
    },
    image: { 
      type: String, 
      required: true 
    },
  },
  { timestamps: true }
);

UserImageSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

UserImageSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

// Ensure one image per user
UserImageSchema.index({ id_owner: 1 }, { unique: true });

export type UserImageDocument = InferSchemaType<typeof UserImageSchema>;

export const UserImage =
  mongoose.models.UserImage || mongoose.model("UserImage", UserImageSchema);
