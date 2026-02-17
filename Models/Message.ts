import mongoose, { Schema, type InferSchemaType } from "mongoose";

const MessageSchema = new Schema(
  {
    id_Chat: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    id_sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    id_reciver: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    read: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Index for efficient querying
MessageSchema.index({ id_Chat: 1, createdAt: -1 });
MessageSchema.index({ id_reciver: 1, read: 1 });

MessageSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

MessageSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type Message = InferSchemaType<typeof MessageSchema> & { id: string };
export const MessageModel = mongoose.model<Message>("Message", MessageSchema);
