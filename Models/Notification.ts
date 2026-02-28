import mongoose, { Schema, type InferSchemaType } from "mongoose";

const NotificationSchema = new Schema(
  {
    id_sender: { 
      type: Schema.Types.ObjectId, 
      required: true,
      ref: 'User' // Default to User, but can reference Workshop too
    },
    id_receiver: { 
      type: Schema.Types.ObjectId, 
      required: true,
      ref: 'User' // Default to User, but can reference Workshop too
    },
    is_read: { 
      type: Boolean, 
      default: false 
    },
    message: { 
      type: String, 
      required: true 
    },
    type: { 
      type: String, 
      enum: ['rdv_workshop', 'message', 'done_rdv_workshop', 'cancel_rdv_workshop', 'car_price_warning', 'other'],
      required: true 
    },
  },
  { timestamps: true }
);

NotificationSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

NotificationSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

// Index for efficient queries
NotificationSchema.index({ id_receiver: 1, is_read: 1 });
NotificationSchema.index({ createdAt: -1 });

export type NotificationDocument = InferSchemaType<typeof NotificationSchema>;

export const Notification =
  mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
