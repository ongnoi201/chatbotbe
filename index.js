import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
    cors({
        origin: (process.env.FRONTEND_ORIGIN || "").split(",").filter(Boolean) || true,
    })
);

// Google AI client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Cloudinary config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DEFAULT_AVATAR =
    "https://gcs.tripi.vn/public-tripi/tripi-feed/img/477733sdR/anh-mo-ta.png";

// Multer (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const ok = ["image/jpg", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
        cb(ok ? null : new Error("Unsupported file type"), ok);
    },
});

// Mongo models
const UserSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true },
        name: String,
        passwordHash: String,
    },
    { timestamps: true }
);

const PersonaSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        name: { type: String, default: "Trợ lý" },
        description: String,
        tone: String,
        style: String,
        language: String,
        rules: [String],
        avatarUrl: { type: String, default: DEFAULT_AVATAR },
    },
    { timestamps: true }
);

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

const User = mongoose.model("User", UserSchema);
const Persona = mongoose.model("Persona", PersonaSchema);
const Message = mongoose.model("Message", MessageSchema);

// Helpers
function personaToSystem({
    name = "Trợ lý",
    description = "",
    tone = "thân thiện",
    style = "ngắn gọn, có ví dụ khi cần",
    language = "Tiếng Việt",
    rules = [],
}) {
    return [
        `# Vai trò & Nhân vật`,
        `Bạn là ${name}. ${description}`,
        `# Phong cách`,
        `- Giọng điệu: ${tone}`,
        `- Văn phong: ${style}`,
        `- Ngôn ngữ mặc định: ${language}`,
        `# Quy tắc`,
        ...(rules.length ? rules.map((r) => `- ${r}`) : ["- Giải thích rõ ràng, đúng trọng tâm."]),
    ].join("\n");
}

function toHistory(messages = []) {
    return messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
}

const defaultSafety = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

// JWT Middleware
function auth(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
}

// Cloudinary helpers
function getCloudinaryPublicId(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split("/");
        const file = parts.pop(); // abc123.jpg
        const folder = parts.pop(); // personas
        if (!file || !folder) return null;
        return `${folder}/${file.split(".")[0]}`;
    } catch {
        return null;
    }
}

function uploadToCloudinary(buffer, filename) {
    const folder = process.env.CLOUDINARY_FOLDER || "personas";
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, public_id: filename, resource_type: "image" },
            (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(buffer);
    });
}

function deleteFromCloudinary(publicId) {
    if (!publicId) return Promise.resolve();
    return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

// Auth routes
app.post("/api/users/register", async (req, res) => {
    try {
        const { email, name, password } = req.body;
        const exist = await User.findOne({ email });
        if (exist) return res.status(400).json({ error: "Email already registered" });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, name, passwordHash });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/users/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "User not found" });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(400).json({ error: "Invalid password" });

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
            expiresIn: "7d",
        });
        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Persona routes
app.post("/api/personas", auth, upload.single("avatar"), async (req, res) => {
    try {
        let avatarUrl = DEFAULT_AVATAR;
        if (req.file) {
            const result = await uploadToCloudinary(req.file.buffer, String(Date.now()));
            avatarUrl = result.secure_url;
        }

        const { name, description, tone, style, language, rules } = req.body;
        const persona = await Persona.create({
            userId: req.userId,
            name,
            description,
            tone,
            style,
            language,
            rules: rules ? (Array.isArray(rules) ? rules : [rules]) : [],
            avatarUrl,
        });

        res.json(persona);
    } catch (err) {
        console.error("❌ Create persona error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

app.get("/api/personas", auth, async (req, res) => {
    try {
        const personas = await Persona.find({ userId: req.userId });
        res.json(personas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put("/api/personas/:id", auth, upload.single("avatar"), async (req, res) => {
    try {
        const { id } = req.params;
        const persona = await Persona.findOne({ _id: id, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        let avatarUrl = persona.avatarUrl;
        if (req.file) {
            if (persona.avatarUrl && persona.avatarUrl !== DEFAULT_AVATAR) {
                const publicId = getCloudinaryPublicId(persona.avatarUrl);
                if (publicId) await deleteFromCloudinary(publicId);
            }
            const result = await uploadToCloudinary(req.file.buffer, String(Date.now()));
            avatarUrl = result.secure_url;
        }

        const { name, description, tone, style, language, rules } = req.body;
        persona.name = name ?? persona.name;
        persona.description = description ?? persona.description;
        persona.tone = tone ?? persona.tone;
        persona.style = style ?? persona.style;
        persona.language = language ?? persona.language;
        persona.rules = rules ? (Array.isArray(rules) ? rules : [rules]) : persona.rules;
        persona.avatarUrl = avatarUrl;

        await persona.save();
        res.json(persona);
    } catch (err) {
        console.error("❌ Update persona error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

app.delete("/api/personas/:id", auth, async (req, res) => {
    try {
        const { id } = req.params;
        const persona = await Persona.findOne({ _id: id, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        if (persona.avatarUrl && persona.avatarUrl !== DEFAULT_AVATAR) {
            const publicId = getCloudinaryPublicId(persona.avatarUrl);
            if (publicId) await deleteFromCloudinary(publicId);
        }

        await Message.deleteMany({ personaId: id });
        await Persona.deleteOne({ _id: id });
        res.json({ success: true, message: "Persona, related messages and avatar deleted" });
    } catch (err) {
        console.error("❌ Delete persona error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Chat routes
const BodySchema = z.object({
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
    model: z.string().default("gemini-2.0-flash-exp"),
    temperature: z.number().min(0).max(2).default(0.7),
    maxOutputTokens: z.number().min(1).max(8192).default(1024),
    safetySettings: z.array(z.any()).optional(),
});

app.post("/api/chat/:personaId", auth, async (req, res) => {
    try {
        const { messages, model, temperature, maxOutputTokens, safetySettings } =
            BodySchema.parse(req.body);

        const persona = await Persona.findOne({ _id: req.params.personaId, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        const userMsg = await Message.create({
            personaId: persona._id,
            role: "user",
            content: messages[messages.length - 1]?.content || "",
        });

        const modelAI = genAI.getGenerativeModel({ model });
        const result = await modelAI.generateContent({
            contents: toHistory(messages),
            systemInstruction: personaToSystem(persona),
            safetySettings: safetySettings?.length ? safetySettings : defaultSafety,
            generationConfig: { temperature, maxOutputTokens },
        });

        const reply = result.response.text();

        const assistantMsg = await Message.create({
            personaId: persona._id,
            role: "assistant",
            content: reply,
        });

        res.json({ reply, userMsg, assistantMsg });
    } catch (err) {
        res.status(500).json({ error: err?.message || "GENERATION_ERROR" });
    }
});

app.post("/api/chat/stream/:personaId", auth, async (req, res) => {
    try {
        const { messages, model, temperature, maxOutputTokens, safetySettings, regenerate } =
            BodySchema.extend({ regenerate: z.boolean().optional() }).parse(req.body);

        const persona = await Persona.findOne({ _id: req.params.personaId, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        let userMsg = null;
        if (regenerate) {
            const lastAssistant = await Message.findOne({ personaId: persona._id, role: "assistant" }).sort({
                createdAt: -1,
            });
            if (lastAssistant) {
                await lastAssistant.deleteOne();
            }
        } else {
            userMsg = await Message.create({
                personaId: persona._id,
                role: "user",
                content: messages[messages.length - 1]?.content || "",
            });
        }

        const modelAI = genAI.getGenerativeModel({ model });
        const stream = await modelAI.generateContentStream({
            contents: toHistory(messages),
            systemInstruction: personaToSystem(persona),
            safetySettings: safetySettings?.length ? safetySettings : defaultSafety,
            generationConfig: { temperature, maxOutputTokens },
        });

        let reply = "";
        for await (const chunk of stream.stream) {
            const text = chunk.text();
            if (text) {
                reply += text;
                res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
            }
        }

        const assistantMsg = await Message.create({
            personaId: persona._id,
            role: "assistant",
            content: reply,
        });

        res.write(`data: ${JSON.stringify({ done: true, reply, userMsg, assistantMsg })}\n\n`);
        res.end();
    } catch (err) {
        console.error("STREAM_ERROR", err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

app.get("/api/chat/:personaId/history", auth, async (req, res) => {
    try {
        const messages = await Message.find({ personaId: req.params.personaId })
            .sort({ createdAt: 1 })
            .limit(100);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/chat/:personaId/delete", auth, async (req, res) => {
    try {
        const { personaId } = req.params;
        const { index } = req.body;
        const persona = await Persona.findOne({ _id: personaId, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        const messages = await Message.find({ personaId }).sort({ createdAt: 1 });
        if (index < 0 || index >= messages.length) {
            return res.status(400).json({ error: "Invalid index" });
        }
        const toDelete = messages.slice(index);
        const ids = toDelete.map((m) => m._id);
        await Message.deleteMany({ _id: { $in: ids } });
        const remaining = await Message.find({ personaId }).sort({ createdAt: 1 });
        res.json(remaining);
    } catch (err) {
        console.error("❌ Lỗi xóa chat:", err);
        res.status(500).json({ error: "Server error" });
    }
});

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));

const port = process.env.PORT || 5050;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
