import { z } from "zod";
import genAI from "../utils/genAI.js";
import Persona from "../models/Persona.js";
import Message from "../models/Message.js";
import { personaToSystem, toHistory } from "../utils/personaHelper.js";
import { enforceMessageLimit } from "../utils/messageHelper.js";

const BodySchema = z.object({
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
    model: z.string().default("gemini-2.5-flash-lite"),
    temperature: z.number().min(0).max(2).default(0.7),
    maxOutputTokens: z.number().min(1).max(8192).default(1024),
    safetySettings: z.array(z.any()).optional(),
});

const BodySchemaStream = BodySchema.extend({ regenerate: z.boolean().optional() });

// non-streaming chat
export const chatWithPersona = async (req, res) => {
    try {
        const { messages, model, temperature, maxOutputTokens, safetySettings } = BodySchema.parse(req.body);

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
            safetySettings: safetySettings?.length ? safetySettings : undefined,
            generationConfig: { temperature, maxOutputTokens },
        });

        const reply = result.response.text();

        const assistantMsg = await Message.create({
            personaId: persona._id,
            role: "assistant",
            content: reply,
            model,
        });

        await enforceMessageLimit(persona._id, 1000);
        res.json({ reply, userMsg, assistantMsg });
    } catch (err) {
        console.error("CHAT_ERROR", err);
        res.status(500).json({ error: err?.message || "GENERATION_ERROR" });
    }
};

// streaming chat (SSE)
export const streamChatWithPersona = async (req, res) => {
    try {
        const { messages, model, temperature, maxOutputTokens, safetySettings, regenerate } =
            BodySchemaStream.parse(req.body);

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
            safetySettings: safetySettings?.length ? safetySettings : undefined,
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
            model,
        });

        await enforceMessageLimit(persona._id, 1000);
        res.write(`data: ${JSON.stringify({ done: true, reply, userMsg, assistantMsg })}\n\n`);
        res.end();
    } catch (err) {
        console.error("STREAM_ERROR", err);
        try {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        } catch (e) {
            // ignore
        }
    }
};

export const getMessages = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 200;
        const before = req.query.before;
        let query = { personaId: req.params.personaId };
        if (before) query.createdAt = { $lt: new Date(before) };
        const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
        res.json(messages.reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getLastMessages = async (req, res) => {
    try {
        const personas = await Persona.find({ userId: req.userId }).select("_id");
        const personaIds = personas.map(p => p._id);

        const lastMessages = await Message.aggregate([
            { $match: { personaId: { $in: personaIds } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$personaId",
                    lastMessage: { $first: "$$ROOT" },
                },
            },
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
};

export const deletePersonaHistory = async (req, res) => {
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
};

export const deleteMessagesFromMessageId = async (req, res) => {
    try {
        const { personaId } = req.params;
        const { messageId } = req.body;
        if (!messageId) {
            return res.status(400).json({ error: "messageId is required" });
        }

        const persona = await Persona.findOne({ _id: personaId, userId: req.userId });
        if (!persona) return res.status(404).json({ error: "Persona not found" });

        const startingMessage = await Message.findById(messageId);
        if (!startingMessage) {
            return res.status(404).json({ error: "Message to delete from not found" });
        }

        // Bảo đảm message thuộc về persona (tránh xóa nhầm)
        if (String(startingMessage.personaId) !== String(personaId)) {
            return res.status(400).json({ error: "Message does not belong to the given persona" });
        }

        await Message.deleteMany({
            personaId: personaId,
            createdAt: { $gte: startingMessage.createdAt },
        });

        const remaining = await Message.find({ personaId }).sort({ createdAt: 1 });
        res.json(remaining);
    } catch (err) {
        console.error("❌ Lỗi xóa chat:", err);
        res.status(500).json({ error: "Server error" });
    }
};