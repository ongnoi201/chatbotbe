import Persona from "../models/Persona.js";
import Message from "../models/Message.js";
import { getCloudinaryPublicId, uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryHelper.js";
import { schedulePersonaJobs, clearPersonaJobs } from "../utils/scheduler.js";
import { DEFAULT_AVATAR } from "../models/Persona.js";

export const createPersona = async (req, res) => {
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
};

export const getPersonas = async (req, res) => {
    try {
        const personas = await Persona.find({ userId: req.userId });
        res.json(personas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updatePersona = async (req, res) => {
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
        persona.rules = rules ? (Array.isArray(rules) ? rules : [rules]) : persona.rules;
        persona.avatarUrl = avatarUrl;
        persona.autoMessageTimes = autoMessageTimes || persona.autoMessageTimes;

        await persona.save();
        await schedulePersonaJobs(persona);
        res.json(persona);
    } catch (err) {
        console.error("❌ Update persona error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

export const deletePersona = async (req, res) => {
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
        clearPersonaJobs(persona._id);

        res.json({ success: true, message: "Persona, related messages and avatar deleted" });
    } catch (err) {
        console.error("❌ Delete persona error:", err);
        res.status(500).json({ error: "Server error" });
    }
};
