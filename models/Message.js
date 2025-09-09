import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
    {
        personaId: { type: mongoose.Schema.Types.ObjectId, ref: "Persona", required: true },
        role: { type: String, enum: ["user", "assistant"], required: true },
        content: { type: String, required: true },
        tokens: Number,
        model: String,
        metadata: Object,
    },
    { timestamps: true }
);

export default mongoose.model("Message", MessageSchema);
