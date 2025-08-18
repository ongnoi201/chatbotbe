import mongoose from "mongoose";

//
// User
//
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    passwordHash: String,
}, { timestamps: true });

//
// Persona
//
const PersonaSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "Trợ lý" },
    description: String,
    tone: String,
    style: String,
    language: String,
    rules: [String],
}, { timestamps: true });

//
// Message
//
const MessageSchema = new mongoose.Schema({
    personaId: { type: mongoose.Schema.Types.ObjectId, ref: "Persona", required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    tokens: Number,
    model: String,
    metadata: Object,
}, { timestamps: true });

export const User = mongoose.model("User", UserSchema);
export const Persona = mongoose.model("Persona", PersonaSchema);
export const Message = mongoose.model("Message", MessageSchema);
