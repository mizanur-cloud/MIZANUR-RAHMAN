export const SCHOOL_LOGO_URL = '/assets/aistudio/logo_ad9fde5b.jpg';

let cachedBytesPromise: Promise<Uint8Array | null> | null = null;
let cachedDataUrlPromise: Promise<string | null> | null = null;
let cachedImagePromise: Promise<HTMLImageElement | null> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function loadSchoolLogoBytes(): Promise<Uint8Array | null> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null;
  if (!cachedBytesPromise) {
    cachedBytesPromise = fetch(SCHOOL_LOGO_URL)
      .then(async res => {
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      })
      .catch(() => null);
  }
  return cachedBytesPromise;
}

export async function loadSchoolLogoDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof btoa === 'undefined') return null;
  if (!cachedDataUrlPromise) {
    cachedDataUrlPromise = loadSchoolLogoBytes()
      .then(bytes => {
        if (!bytes) return null;
        return `data:image/jpeg;base64,${arrayBufferToBase64(bytes.buffer as ArrayBuffer)}`;
      })
      .catch(() => null);
  }
  return cachedDataUrlPromise;
}

export async function loadSchoolLogoImage(): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return null;
  if (!cachedImagePromise) {
    cachedImagePromise = new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = SCHOOL_LOGO_URL;
    });
  }
  return cachedImagePromise;
}
