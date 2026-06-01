export const MEDIA_FOLDER_SLUGS = [
  'general',
  'builder',
  'banners',
  'products',
  'categories',
  'brand',
] as const;

export type MediaFolderSlug = (typeof MEDIA_FOLDER_SLUGS)[number];

export const DEFAULT_MEDIA_FOLDER: MediaFolderSlug = 'general';

export function normalizeMediaFolder(value: unknown): MediaFolderSlug {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (MEDIA_FOLDER_SLUGS.includes(slug as MediaFolderSlug)) {
    return slug as MediaFolderSlug;
  }
  return DEFAULT_MEDIA_FOLDER;
}

export type MediaSortField = 'newest' | 'oldest' | 'name' | 'size';

export function normalizeMediaSort(value: unknown): MediaSortField {
  const sort = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (sort === 'oldest' || sort === 'name' || sort === 'size') return sort;
  return 'newest';
}
