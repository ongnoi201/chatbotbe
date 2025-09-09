import webpush from "../config/webpush.js";
import Subscription from "../models/Subscription.js";

export async function sendPushNotification(userId, personaName, message) {
    const subs = await Subscription.find({ userId });
    for (const s of subs) {
        try {
            await webpush.sendNotification(s.subscription, JSON.stringify({ title: personaName, body: message }));
        } catch (err) {
            console.error("❌ Push error:", err);
        }
    }
}
