import { useState, type ChangeEvent, type ReactNode } from "react";
import type { AdventureThumbnailImage } from "../types/adventure";
import { thumbnailAltText } from "../utils/adventureImages";

const MAX_THUMBNAIL_DIMENSION = 1400;
const JPEG_QUALITY = 0.86;

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("That image could not be loaded."));
    };
    image.src = objectUrl;
  });
}

async function makeThumbnail(file: File): Promise<AdventureThumbnailImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }

  const image = await fileToImage(file);
  const scale = Math.min(1, MAX_THUMBNAIL_DIMENSION / image.width, MAX_THUMBNAIL_DIMENSION / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not prepare this image.");
  context.drawImage(image, 0, 0, width, height);

  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mimeType, mimeType === "image/jpeg" ? JPEG_QUALITY : undefined);
  return {
    dataUrl,
    mimeType,
    name: file.name,
    altText: file.name.replace(/\.[^.]+$/, ""),
    updatedAt: new Date().toISOString(),
  };
}

export function AdventureThumbnailFrame({
  thumbnail,
  title,
  className = "",
  children,
}: {
  thumbnail?: AdventureThumbnailImage;
  title: string;
  className?: string;
  children?: ReactNode;
}) {
  const initial = title.trim().slice(0, 1).toUpperCase() || "A";
  return (
    <div className={`adventure-thumbnail-frame${thumbnail ? " has-thumbnail" : ""}${className ? ` ${className}` : ""}`}>
      {thumbnail ? (
        <img src={thumbnail.dataUrl} alt={thumbnailAltText(title, thumbnail)} />
      ) : (
        <div className="adventure-thumbnail-fallback" aria-hidden="true">
          <span>{initial}</span>
        </div>
      )}
      {children}
    </div>
  );
}

export function AdventureThumbnailPicker({
  thumbnail,
  title,
  onChange,
  compact = false,
}: {
  thumbnail?: AdventureThumbnailImage;
  title: string;
  onChange: (thumbnail: AdventureThumbnailImage | undefined) => void;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | undefined>();
  const chooseLabel = compact
    ? thumbnail ? "Change cover" : "Add cover"
    : thumbnail ? "Change thumbnail" : "Add thumbnail image";

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      setError(undefined);
      onChange(await makeThumbnail(file));
    } catch (thumbnailError) {
      setError(thumbnailError instanceof Error ? thumbnailError.message : "Image upload failed.");
    }
  }

  return (
    <div className={`thumbnail-picker${compact ? " compact" : ""}`}>
      {!compact && (
        <AdventureThumbnailFrame thumbnail={thumbnail} title={title} className="thumbnail-picker-preview" />
      )}
      <div className="thumbnail-picker-controls">
        <label className="file-button">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
          {chooseLabel}
        </label>
        {thumbnail && (
          <button type="button" onClick={() => onChange(undefined)}>
            {compact ? "Remove" : "Remove image"}
          </button>
        )}
        {!compact && thumbnail?.name && <span className="muted thumbnail-file-name">{thumbnail.name}</span>}
      </div>
      {error && <p className="error-inline">{error}</p>}
    </div>
  );
}
