export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Returns an error message if the image is unsupported/oversized (vision limits), else null. */
export function validateImage(file: { type: string; size: number }): string | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return `Unsupported image type: ${file.type || "unknown"} (use PNG, JPEG, GIF, or WebP).`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image is too large (max 5 MB).";
  }
  return null;
}

/** Read a Blob to a base64 string WITHOUT the `data:...;base64,` prefix. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}
