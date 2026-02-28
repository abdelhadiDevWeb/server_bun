import mongoose, { Schema, type InferSchemaType } from "mongoose";

const RateSchema = new Schema(
  {
    id_rater: { 
      type: Schema.Types.ObjectId, 
      required: true,
      ref: 'User' // User who gives the rating
    },
    target: { 
      type: Schema.Types.ObjectId, 
      required: true,
      refPath: 'targetType' // Can reference Workshop or User
    },
    targetType: {
      type: String,
      required: true,
      enum: ['Workshop', 'User'],
      default: 'Workshop'
    },
    message: { 
      type: String, 
      trim: true,
      default: null
    },
    star: { 
      type: Number, 
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: function(v: number) {
          return v >= 1 && v <= 5 && Number.isInteger(v);
        },
        message: 'La note doit être un entier entre 1 et 5'
      }
    },
  },
  { timestamps: true }
);

// Index to ensure one rating per user per target (workshop or user)
RateSchema.index({ id_rater: 1, target: 1, targetType: 1 }, { unique: true });

RateSchema.virtual("id").get(function (this: any) {
  return this._id?.toString();
});

RateSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export type RateDocument = InferSchemaType<typeof RateSchema>;

export const Rate =
  mongoose.models.Rate || mongoose.model("Rate", RateSchema);
