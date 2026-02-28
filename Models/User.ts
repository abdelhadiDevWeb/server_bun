import mongoose, { Schema, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, unique: true, index: true, lowercase: true },
    phone: { type: String, required: true, trim: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['client', 'admin'], default: 'client' },
    status: { type: Boolean, default: false },
    verfie: { type: Boolean, default: false },
    certifie: { type: Boolean, default: false },
    profileImage: { type: String, default: null },
  },
  { timestamps: true }
);

UserSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

UserSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    delete ret.password;
    return ret;
  },
});

export type UserDocument = InferSchemaType<typeof UserSchema>;

export const User =
  mongoose.models.User || mongoose.model("User", UserSchema);

