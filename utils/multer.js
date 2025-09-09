import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const ok = ["image/jpg", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            file.mimetype
        );
        cb(ok ? null : new Error("Unsupported file type"), ok);
    },
});

export default upload;
