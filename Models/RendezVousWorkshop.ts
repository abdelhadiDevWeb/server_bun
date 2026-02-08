import mongoose, { Schema, type InferSchemaType } from "mongoose";

const RendezVousWorkshopSchema = new Schema(
  {
    id_workshop: { 
      type: Schema.Types.ObjectId, 
      required: true, 
      ref: 'Workshop',
      index: true
    },
    id_owner_car: { 
      type: Schema.Types.ObjectId, 
      required: true, 
      ref: 'User',
      index: true
    },
    id_car: { 
      type: Schema.Types.ObjectId, 
      required: true, 
      ref: 'Car',
      index: true
    },
    date: { 
      type: Date, 
      required: true 
    },
    time: { 
      type: String, 
      required: true 
    },
    status: { 
      type: String, 
      enum: ['en_attente', 'accepted', 'refused'],
      default: 'en_attente' 
    },
  },
  { timestamps: true }
);

RendezVousWorkshopSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

RendezVousWorkshopSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

// Index for efficient queries
RendezVousWorkshopSchema.index({ id_workshop: 1, date: 1 });
RendezVousWorkshopSchema.index({ id_owner_car: 1 });
RendezVousWorkshopSchema.index({ status: 1 });

export type RendezVousWorkshopDocument = InferSchemaType<typeof RendezVousWorkshopSchema>;

export const RendezVousWorkshop =
  mongoose.models.RendezVousWorkshop || mongoose.model("RendezVousWorkshop", RendezVousWorkshopSchema);
