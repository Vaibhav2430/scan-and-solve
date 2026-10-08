import type { ScanRect } from "./types";

export function scaleRectToImage(
  rect: ScanRect,
  viewport: { width: number; height: number },
  image: { width: number; height: number }
): ScanRect {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;

  const x = Math.max(0, Math.round(rect.x * scaleX));
  const y = Math.max(0, Math.round(rect.y * scaleY));
  const right = Math.min(image.width, Math.round((rect.x + rect.width) * scaleX));
  const bottom = Math.min(image.height, Math.round((rect.y + rect.height) * scaleY));

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
}

export async function cropScreenshot(
  screenshotDataUrl: string,
  rect: ScanRect,
  viewport: { width: number; height: number }
): Promise<string> {
  const response = await fetch(screenshotDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  const crop = scaleRectToImage(rect, viewport, bitmap);
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Could not create the image crop.");
  }

  context.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode the image crop."));
    reader.readAsDataURL(blob);
  });
}
