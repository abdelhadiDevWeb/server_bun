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
    id_car: {
      type: Schema.Types.ObjectId,
      ref: 'Car',
      required: false,
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
      enum: ['rdv_workshop', 'message', 'done_rdv_workshop', 'cancel_rdv_workshop', 'car_price_warning', 'new_register', 'other'],
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

// Enhanced indexes for efficient queries
NotificationSchema.index({ id_receiver: 1, is_read: 1, createdAt: -1 }); // User notifications with read status
NotificationSchema.index({ id_receiver: 1, type: 1, is_read: 1, createdAt: -1 }); // Filtered notifications
NotificationSchema.index({ id_sender: 1, createdAt: -1 }); // Sender queries
NotificationSchema.index({ type: 1, is_read: 1, createdAt: -1 }); // Admin type queries

export type NotificationDocument = InferSchemaType<typeof NotificationSchema>;

export const Notification =
  mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
