import cron from "node-cron";
import { generateRandomMessage } from "./genAI.js";
import Notify from "../models/Notify.js";

const cronJobs = {};
export function clearPersonaJobs(personaId) {
    if (cronJobs[personaId]) {
        cronJobs[personaId].forEach((job) => job.stop());
        delete cronJobs[personaId];
    }
}

export async function schedulePersonaJobs(persona) {
    clearPersonaJobs(persona._id);
    if (persona.autoMessageTimes?.length) {
        cronJobs[persona._id] = [];
        for (const time of persona.autoMessageTimes) {
            // Xử lý định dạng "HH:mm" thành cron daily
            let cronTime = time;
            if (/^\d{2}:\d{2}$/.test(time)) {
                const [hour, minute] = time.split(":");
                // Cron format: second minute hour day-of-month month day-of-week
                // '0 {minute} {hour} * * *' -> daily at HH:mm:00
                cronTime = `0 ${minute} ${hour} * * *`;
            }

            try {
                // 1. Thử lập lịch cron job
                const job = cron.schedule(
                    cronTime,
                    async () => {
                        await generateRandomMessage(persona, time);
                    },
                    { 
                        timezone: "Asia/Ho_Chi_Minh" 
                    }
                );
                cronJobs[persona._id].push(job);
                
            } catch (err) {
                // 2. Bắt lỗi nếu biểu thức cron (cronTime) không hợp lệ
                console.error(`[LỖI CRON] Biểu thức cron không hợp lệ cho persona: ${persona.name} (ID: ${persona._id}), Thời gian: ${time}. Chi tiết lỗi:`, err);
                try {
                    await Notify.create({
                        category: "FAILURE",
                        name: "schedulePersonaJobs",
                        message: `Biểu thức cron không hợp lệ cho ${persona.name} tại thời điểm: ${time}.`,
                        personaId: persona._id,
                        userId: persona.userId
                    });
                } catch (notifyErr) {
                    console.error(`[LỖI GHI NOTIFY] Không thể tạo mục Notify sau khi xảy ra lỗi Cron. Chi tiết lỗi Notify:`, notifyErr);
                }
            }
        }
    }
}