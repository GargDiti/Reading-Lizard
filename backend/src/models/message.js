import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },

    content: {
      type: String,
      required() {
        return this.status !== "streaming";
      },
      trim: true,
    },
    status: {
      type: String,
      enum: ["complete", "streaming", "incomplete", "failed"],
      default: "complete",
    },
    requestId: {
      type: String,
      default: undefined,
    },
    inReplyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.index(
  { conversationId: 1, requestId: 1 },
  {
    unique: true,
    partialFilterExpression: { requestId: { $type: "string" } },
  },
);
messageSchema.index(
  { inReplyTo: 1 },
  {
    unique: true,
    partialFilterExpression: { inReplyTo: { $type: "objectId" } },
  },
);

const Message = mongoose.model("Message", messageSchema);

export default Message;