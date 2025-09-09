import mongoose from "mongoose";

const SubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subscription: { type: Object, required: true },
});

export default mongoose.model("Subscription", SubscriptionSchema);
