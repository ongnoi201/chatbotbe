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
import cron from "node-cron";
import webpush from "web-push";

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

// Generate VAPID keys (chỉ cần 1 lần, rồi lưu vào .env)
webpush.setVapidDetails(
    "mailto:laogia.jp60@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);


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
        autoMessageTimes: [String],
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

const SubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subscription: { type: Object, required: true },
});

const User = mongoose.model("User", UserSchema);
const Persona = mongoose.model("Persona", PersonaSchema);
const Message = mongoose.model("Message", MessageSchema);
const Subscription = mongoose.model("Subscription", SubscriptionSchema);

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

// Giữ lại tối đa 1000 tin nhắn gần nhất cho persona
async function enforceMessageLimit(personaId, limit = 1000) {
    const count = await Message.countDocuments({ personaId });
    if (count > limit) {
        const excess = count - limit;
        const oldMessages = await Message.find({ personaId })
            .sort({ createdAt: 1 })
            .limit(excess)
            .select("_id");
        const ids = oldMessages.map(m => m._id);
        if (ids.length) {
            await Message.deleteMany({ _id: { $in: ids } });
        }
    }
}

// Hàm sinh tin nhắn random từ persona
async function generateRandomMessage(persona, time) {
    try {
        // Lấy 2 tin nhắn gần nhất
        const lastMessages = await Message.find({ personaId: persona._id })
            .sort({ createdAt: -1 })
            .limit(2);

        // Đảo ngược thứ tự (cũ → mới)
        const ordered = lastMessages.reverse();
        const modelAI = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await modelAI.generateContent({
            contents: [
                // thêm ngữ cảnh hệ thống
                {
                    role: "user",
                    parts: [{
                        text: `
                            Bạn là ${persona.name}, ${persona.description}.
                            Hiện tại là thời điểm ${time}.
                            Hãy gửi một tin nhắn ngắn gọn, tự nhiên, đúng ngữ cảnh thời gian và tiếp nối mạch hội thoại thay vì mở đầu lại.`
                    }]
                },
                // nối 2 tin nhắn cuối vào
                ...toHistory(ordered),
            ],
            systemInstruction: personaToSystem(persona),
            generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
            safetySettings: defaultSafety,
        });

        const text = result.response.text().trim();
        return text.length > 0 ? text : "Xin chào 👋";
    } catch (err) {
        console.error("Lỗi AI:", err);
        return "Xin chào 👋";
    }
}

async function sendPushNotification(userId, personaName, message) {
    const subs = await Subscription.find({ userId });
    for (const s of subs) {
        try {
            await webpush.sendNotification(
                s.subscription,
                JSON.stringify({ title: personaName, body: message })
            );
        } catch (err) {
            console.error("❌ Push error:", err);
        }
    }
}

const cronJobs = {};
function clearPersonaJobs(personaId) {
    if (cronJobs[personaId]) {
        cronJobs[personaId].forEach(job => job.stop());
        delete cronJobs[personaId];
    }
}

async function schedulePersonaJobs(persona) {
    clearPersonaJobs(persona._id); // xóa job cũ nếu có

    if (persona.autoMessageTimes?.length) {
        cronJobs[persona._id] = [];

        persona.autoMessageTimes.forEach(time => {
            // Nếu người dùng chỉ nhập "HH:mm", convert thành cron
            let cronTime = time;
            if (/^\d{2}:\d{2}$/.test(time)) {
                const [hour, minute] = time.split(":");
                cronTime = `0 ${minute} ${hour} * * *`; // chạy hằng ngày
            }

            const job = cron.schedule(cronTime, async () => {
                const reply = await generateRandomMessage(persona, time);
                await Message.create({
                    personaId: persona._id,
                    role: "assistant",
                    content: reply,
                    metadata: { auto: true, scheduled: true, time },
                });
                sendPushNotification(persona.userId, persona.name, reply);
            }, { timezone: "Asia/Ho_Chi_Minh" });

            cronJobs[persona._id].push(job);
        });
    }
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

        const userObj = user.toObject();
        delete userObj.passwordHash;

        res.json({ token, user: userObj });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post("/api/subscribe", auth, async (req, res) => {
    try {
        const { subscription } = req.body;
        const existingSub = await Subscription.findOne({
            userId: req.userId,
            "subscription.endpoint": subscription.endpoint,
        });

        if (!existingSub) {
            await Subscription.create({
                userId: req.userId,
                subscription: subscription,
            });
            console.log("✅ New subscription saved.");
        } else {
            console.log("ℹ️ Subscription already exists.");
        }

        res.json({ success: true });
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

        const { name, description, tone, style, language, rules, autoMessageTimes } = req.body;
        const persona = await Persona.create({
            userId: req.userId,
            name,
            description,
            tone,
            style,
            language,
            rules: rules ? (Array.isArray(rules) ? rules : [rules]) : [],
            avatarUrl,
            autoMessageTimes: autoMessageTimes || [],
        });

        await schedulePersonaJobs(persona);
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

        if (req.file && req.file.buffer?.length) {
            if (persona.avatarUrl && persona.avatarUrl !== DEFAULT_AVATAR) {
                const publicId = getCloudinaryPublicId(persona.avatarUrl);
                if (publicId) await deleteFromCloudinary(publicId);
            }

            const result = await uploadToCloudinary(req.file.buffer, String(Date.now()));
            avatarUrl = result.secure_url;
        }

        const { name, description, tone, style, language, rules, autoMessageTimes } = req.body;
        persona.name = name ?? persona.name;
        persona.description = description ?? persona.description;
        persona.tone = tone ?? persona.tone;
        persona.style = style ?? persona.style;
        persona.language = language ?? persona.language;
        persona.rules = rules
            ? (Array.isArray(rules) ? rules : [rules])
            : persona.rules;
        persona.avatarUrl = avatarUrl;
        persona.autoMessageTimes = autoMessageTimes || persona.autoMessageTimes;

        await persona.save();
        await schedulePersonaJobs(persona);
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

        await enforceMessageLimit(persona._id, 1000);
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

        await enforceMessageLimit(persona._id, 1000);
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
        const limit = parseInt(req.query.limit) || 200;
        const before = req.query.before;

        let query = { personaId: req.params.personaId };

        if (before) {
            query.createdAt = { $lt: new Date(before) };
        }

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(limit);
        res.json(messages.reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get("/api/personas/last-messages", auth, async (req, res) => {
    try {
        const personas = await Persona.find({ userId: req.userId }).select("_id");
        const personaIds = personas.map(p => p._id);
        const lastMessages = await Message.aggregate([
            { $match: { personaId: { $in: personaIds } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$personaId",
                    lastMessage: { $first: "$$ROOT" }
                }
            }
        ]);

        const result = lastMessages.reduce((acc, item) => {
            acc[item._id] = item.lastMessage;
            return acc;
        }, {});

        res.json(result);
    } catch (err) {
        console.error("❌ Lỗi khi lấy tin nhắn cuối cùng:", err);
        res.status(500).json({ error: "Server error" });
    }
});


app.delete("/api/chat/:personaId/history", auth, async (req, res) => {
    try {
        const { personaId } = req.params;
        const persona = await Persona.findOne({ _id: personaId, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        await Message.deleteMany({ personaId });
        res.json({ success: true, message: "All chat history deleted" });
    } catch (err) {
        console.error("❌ Lỗi xóa toàn bộ lịch sử chat:", err);
        res.status(500).json({ error: "Server error" });
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

app.get("/api/health-check", (req, res) => {
    console.log("Health check endpoint was pinged by UptimeRobot.");
    res.status(200).json({ status: "ok", message: "Server is awake." });
});

mongoose.connect(process.env.MONGO_URI).then(async () => {
    console.log("✅ MongoDB connected");
    const personas = await Persona.find({});
    for (const persona of personas) {
        await schedulePersonaJobs(persona);
    }
});

const port = process.env.PORT || 5050;
app.listen(port, () => console.log(`Server listening on ${port}`));
