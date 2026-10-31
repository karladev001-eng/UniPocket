// Decodes a picked image and re-encodes it as a downscaled JPEG data URL (notes, background).
export async function imageData(file: File): Promise<string> {
  if (file.size > 40 * 1024 * 1024)
    throw Error("画像は40MB以内で選択してください。");
  if (
    !/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type) &&
    !/\.(heic|heif)$/i.test(file.name)
  )
    throw Error("PNG・JPEG・WebP、対応ブラウザのHEICを選択してください。");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw Error(
        "このブラウザでは画像を読み取れません。HEICはJPEG・PNGに変換して選択してください。",
      );
    });
    if (!img.width || !img.height || img.width > 20000 || img.height > 20000)
      throw Error("画像のサイズが対応範囲外です。");
    const scale = Math.min(1, 2400 / Math.max(img.width, img.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
