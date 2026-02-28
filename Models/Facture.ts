import mongoose, { Schema, type InferSchemaType } from "mongoose";

const FactureSchema = new Schema(
  {
    id_workshop: {
      type: Schema.Types.ObjectId,
      ref: "Workshop",
      required: true,
      index: true,
    },
    id_user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    service: {
      type: String,
      required: true,
      enum: ['mécanique', 'vérification peinture', 'mécanique & peinture'],
      trim: true,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: true }
);

FactureSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

FactureSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type FactureDocument = InferSchemaType<typeof FactureSchema>;

export const Facture =
  mongoose.models.Facture || mongoose.model("Facture", FactureSchema);
