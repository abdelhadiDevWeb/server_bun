import mongoose, { Schema, type InferSchemaType } from "mongoose";

const CarSchema = new Schema(
  {
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    year: { type: Number, required: true, min: 1900, max: new Date().getFullYear() + 1 },
    km: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    status: { 
      type: String, 
      enum: ['no_proccess', 'en_attente', 'actif', 'sold'], 
      default: 'no_proccess' 
    },
    images: [{ type: String, required: true }], // Array of image paths
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Reference to User (seller)
    vin: { 
      type: String, 
      trim: true,
      uppercase: true,
      default: null 
    }, // Vehicle Identification Number
    vinData: { 
      type: Schema.Types.Mixed, 
      default: null 
    }, // VIN decoded data from API
    vinRemark: {
      type: String,
      trim: true,
      default: null
    }, // VIN remark (e.g., "2020 Toyota Camry")
  },
  { timestamps: true }
);

CarSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

CarSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type CarDocument = InferSchemaType<typeof CarSchema>;

export const Car =
  mongoose.models.Car || mongoose.model("Car", CarSchema);
