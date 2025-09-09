import cloudinary from "../config/cloudinary.js";

export function getCloudinaryPublicId(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split("/");
        const file = parts.pop();
        const folder = parts.pop();
        if (!file || !folder) return null;
        return `${folder}/${file.split(".")[0]}`;
    } catch {
        return null;
    }
}

export function uploadToCloudinary(buffer, filename) {
    const folder = process.env.CLOUDINARY_FOLDER || "personas";
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, public_id: filename, resource_type: "image" },
            (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(buffer);
    });
}

export function deleteFromCloudinary(publicId) {
    if (!publicId) return Promise.resolve();
    return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}
