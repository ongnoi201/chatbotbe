import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import { connectDB } from "./config/database.js";
import "./config/cloudinary.js";
import "./config/webpush.js";

import authRoutes from "./routes/authRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import personaRoutes from "./routes/personaRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";

import Persona from "./models/Persona.js";
import { schedulePersonaJobs } from "./utils/scheduler.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
    cors({
        origin: (process.env.FRONTEND_ORIGIN || "").split(",").filter(Boolean) || true,
    })
);

// Routes
app.use("/api/users", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/personas", personaRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api", subscriptionRoutes);

app.get("/api/health-check", (req, res) => {
    console.log("Health check endpoint was pinged by UptimeRobot.");
    res.status(200).json({ status: "ok", message: "Server is awake." });
});

// Connect DB and schedule existing persona cron jobs
connectDB(process.env.MONGO_URI).then(async () => {
    console.log("✅ MongoDB connected");
    const personas = await Persona.find({});
    for (const persona of personas) {
        await schedulePersonaJobs(persona);
    }

    const port = process.env.PORT || 5050;
    app.listen(port, () => console.log(`Server listening on ${port}`));
}).catch(err => {
    console.error("MongoDB connection failed:", err);
    process.exit(1);
});
