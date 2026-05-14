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
    /** Last known seller position (GPS + reverse geocode) for nearby workshops */
    locationLat: { type: Number, default: null },
    locationLng: { type: Number, default: null },
    locationFormattedAddress: { type: String, default: null, trim: true },
    locationRegion: { type: String, default: null, trim: true },
    locationCity: { type: String, default: null, trim: true },
    locationCountry: { type: String, default: null, trim: true },
    profileImage: { type: String, default: null },
    // Push notification tokens
    pushToken: { type: String, default: null, sparse: true },
    platform: { type: String, enum: ['ios', 'android'], default: null },
    deviceId: { type: String, default: null },
    pushTokenUpdatedAt: { type: Date, default: null },
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

