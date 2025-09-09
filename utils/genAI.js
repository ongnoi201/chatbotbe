import { GoogleGenerativeAI } from "@google/generative-ai";
import Message from "../models/Message.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
export default genAI;

// Hàm tạo tin nhắn random (dùng cho scheduler)
export async function generateRandomMessage(persona, time) {
    try {
        const lastMessages = await Message.find({ personaId: persona._id })
            .sort({ createdAt: -1 })
            .limit(2);

        let context = "Chưa có cuộc trò chuyện trước đó.";
        if (lastMessages.length > 0) {
            const ordered = lastMessages.reverse();
            context = ordered
                .map((m) => `${m.role === "user" ? "Người dùng" : persona.name}: "${m.content}"`)
                .join("\n");
        }

        const prompt = `
            Bạn là ${persona.name}, ${persona.description}.
            Hiện tại là thời điểm ${time}.
            Dưới đây là những tin nhắn gần nhất:
            ${context}
            Hãy gửi một tin nhắn ngắn gọn, tự nhiên, mang cảm giác tiếp nối hội thoại thay vì mở đầu lại.
            `;

        const modelAI = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await modelAI.generateContent(prompt);
        const text = result.response.text().trim();
        return text.length > 0 ? text : "Xin chào 👋";
    } catch (err) {
        console.error("Lỗi AI generateRandomMessage:", err);
        return "Xin chào 👋";
    }
}
