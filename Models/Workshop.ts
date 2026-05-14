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
    verfie: { type: Boolean, default: true },
    certifie: { type: Boolean, default: true },
    price_visit_mec: { type: Number, default: null },
    price_visit_paint: { type: Number, default: null },
    /** Google Maps pin / geocoded workshop location */
    locationLat: { type: Number, default: null },
    locationLng: { type: Number, default: null },
    locationFormattedAddress: { type: String, default: null, trim: true },
    googlePlaceId: { type: String, default: null, trim: true },
    /** Parsed from geocoder (Nominatim / Google) — stored for search & admin */
    locationCity: { type: String, default: null, trim: true },
    locationRegion: { type: String, default: null, trim: true },
    locationPostalCode: { type: String, default: null, trim: true },
    locationCountry: { type: String, default: null, trim: true },
    locationNeighborhood: { type: String, default: null, trim: true },
    locationStreetLine: { type: String, default: null, trim: true },
    real_time: { type: Boolean, default: false },
    // Push notification tokens
    pushToken: { type: String, default: null, sparse: true },
    platform: { type: String, enum: ['ios', 'android'], default: null },
    deviceId: { type: String, default: null },
    pushTokenUpdatedAt: { type: Date, default: null },
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

