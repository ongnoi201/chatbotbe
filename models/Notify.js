import mongoose from "mongoose";

const notifySchema = new mongoose.Schema({
    category: {
        type: String,
        required: true,
        enum: ["SUCCESS", "FAILURE"],
    },
    name: {
        type: String,
        required: true,
    },
    time: {
        type: Date,
        default: Date.now,
    },
    message: {
        type: String,
        required: true,
    },
    personaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Persona",
        required: false,
        default: null
    },
    userId: { // Thêm trường này
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
});

const Notify = mongoose.model("Notify", notifySchema);
export default Notify;