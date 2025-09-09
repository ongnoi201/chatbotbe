import cron from "node-cron";
import Message from "../models/Message.js";
import { generateRandomMessage } from "./genAI.js";
import { sendPushNotification } from "./webpushHelper.js";

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
        persona.autoMessageTimes.forEach((time) => {
            // Nếu chỉ "HH:mm" -> cron daily
            let cronTime = time;
            if (/^\d{2}:\d{2}$/.test(time)) {
                const [hour, minute] = time.split(":");
                cronTime = `0 ${minute} ${hour} * * *`; // daily at HH:mm:00
            }

            try {
                const job = cron.schedule(
                    cronTime,
                    async () => {
                        const reply = await generateRandomMessage(persona, time);
                        await Message.create({
                            personaId: persona._id,
                            role: "assistant",
                            content: reply,
                            metadata: { auto: true, scheduled: true, time },
                        });
                        await sendPushNotification(persona.userId, persona.name, reply);
                    },
                    { timezone: "Asia/Ho_Chi_Minh" }
                );
                cronJobs[persona._id].push(job);
            } catch (err) {
                console.error("Invalid cron expression for persona time:", time, err);
            }
        });
    }
}
