import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ChatSchema = new Schema(
  {
    id_user1: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    id_user2: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
  },
  { timestamps: true }
);

// Note: We'll handle uniqueness in the route logic to check both directions
// (user1-user2 and user2-user1 should be considered the same chat)

ChatSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

ChatSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type Chat = InferSchemaType<typeof ChatSchema> & { id: string };
export const ChatModel = mongoose.model<Chat>("Chat", ChatSchema);
