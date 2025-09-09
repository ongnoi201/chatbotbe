import Subscription from "../models/Subscription.js";

export const addSubscription = async (req, res) => {
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
};
