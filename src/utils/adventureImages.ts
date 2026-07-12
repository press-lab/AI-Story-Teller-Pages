import type { Adventure, AdventureThumbnailImage, JsonObject } from "../types/adventure";

export const ADVENTURE_THUMBNAIL_METADATA_KEY = "thumbnailImage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAdventureThumbnail(source: Pick<Adventure, "metadata"> | { metadata?: JsonObject }): AdventureThumbnailImage | undefined {
  const value = source.metadata?.[ADVENTURE_THUMBNAIL_METADATA_KEY];
  if (!isRecord(value)) return undefined;
  const dataUrl = value.dataUrl;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return undefined;
  return {
    dataUrl,
    name: typeof value.name === "string" ? value.name : undefined,
    altText: typeof value.altText === "string" ? value.altText : undefined,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

export function thumbnailMetadataPatch(thumbnail: AdventureThumbnailImage | null): JsonObject {
  return { [ADVENTURE_THUMBNAIL_METADATA_KEY]: thumbnail };
}

export function thumbnailAltText(title: string, thumbnail?: AdventureThumbnailImage): string {
  return thumbnail?.altText?.trim() || `${title} thumbnail image`;
}
