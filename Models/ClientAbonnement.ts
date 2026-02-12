import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ClientAbonnementSchema = new Schema(
  {
    type_abonnement: { 
      type: Schema.Types.ObjectId, 
      ref: "TypeAbonnement", 
      required: true 
    },
    client: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'clientType'
    },
    clientType: {
      type: String,
      required: true,
      enum: ['User', 'Workshop']
    },
    date_start: { type: Date, required: true },
    date_end: { type: Date, required: true },
    price: { type: Number, required: true },
  },
  { timestamps: true }
);

ClientAbonnementSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

ClientAbonnementSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type ClientAbonnementDocument = InferSchemaType<typeof ClientAbonnementSchema>;

export const ClientAbonnement =
  mongoose.models.ClientAbonnement || mongoose.model("ClientAbonnement", ClientAbonnementSchema);
