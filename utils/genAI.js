import { GoogleGenerativeAI } from "@google/generative-ai";
import Message from "../models/Message.js";
import Notify from "../models/Notify.js";
import { sendPushNotification } from "./webpushHelper.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
export default genAI;

// Hàm tạo tin nhắn random (dùng cho scheduler)
export async function generateRandomMessage(persona, time) {
    let generatedText = null;
    const functionName = "generateRandomMessage";

    try {
        // 1. Lấy tin nhắn gần nhất để tạo context
        const lastMessages = await Message.find({ personaId: persona._id })
            .sort({ createdAt: -1 })
            .limit(1);

        let context = "Chưa có cuộc trò chuyện trước đó.";
        if (lastMessages.length > 0) {
            const ordered = lastMessages.reverse();
            context = ordered
                .map((m) => `${m.role === "user" ? "Người dùng" : persona.name}: "${m.content}"`)
                .join("\n");
        }

        // 2. Chuẩn bị Prompt và gọi AI
        const prompt = `
            Bạn là ${persona.name}, ${persona.description}.
            Hiện tại là thời điểm ${time}.
            Dưới đây là những tin nhắn gần nhất:
            ${context}
            Hãy gửi một tin nhắn ngắn gọn, tự nhiên, mang cảm giác tiếp nối hội thoại thay vì mở đầu lại.
            `;

        const modelAI = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const result = await modelAI.generateContent(prompt);
        generatedText = result.response.text().trim();

        if (generatedText && generatedText.length > 0) {

            // 3. Xử lý THÀNH CÔNG:

            // 3a. Lưu tin nhắn mới vào Message Model (Cần model Message của bạn)
            await Message.create({
                personaId: persona._id,
                role: "assistant",
                content: generatedText,
                metadata: { auto: true, scheduled: true, time },
            });

            // 3b. Lưu thông báo thành công vào Notify Model
            await Notify.create({
                category: "SUCCESS",
                name: functionName,
                message: `${persona.name} đã gửi cho bạn tin nhắn mới`,
                personaId: persona._id,
                userId: persona.userId
            });

            // 3c. Gửi thông báo đẩy cho người dùng
            await sendPushNotification(persona.userId, persona.name, generatedText);
            // Trả về tin nhắn đã tạo (tùy chọn)
            return generatedText;

        } else {
            // Trường hợp AI trả về chuỗi rỗng
            throw new Error("AI generated an empty response.");
        }

    } catch (err) {
        const errorMessage = `Lỗi AI/DB trong ${functionName}: ${err.message}`;
        console.error(`❌ ${errorMessage}`);

        // Lưu thông báo thất bại vào Notify Model
        await Notify.create({
            category: "FAILURE",
            name: functionName,
            message: `${persona.name} đã gặp lỗi khi tạo tin nhắn cho bạn`,
            personaId: persona._id,
            userId: persona.userId
        });
        await sendPushNotification(persona.userId, persona.name, "Lỗi khi tạo tin nhắn cho bạn");
    }
}
