import exifr from 'exifr';

// Reads time and GPS position from a photo's EXIF metadata (null when absent).
export async function readPhotoMeta(file) {
  try {
    const x = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] });
    if (!x) return { time: null, lat: null, lon: null };
    const time = x.DateTimeOriginal ?? x.CreateDate ?? null;
    const ok = Number.isFinite(x.latitude) && Number.isFinite(x.longitude);
    return {
      time: time instanceof Date && !isNaN(time) ? time : null,
      lat: ok ? x.latitude : null,
      lon: ok ? x.longitude : null,
    };
  } catch {
    return { time: null, lat: null, lon: null };
  }
}

// Downscales a photo to keep storage on the phone small.
export async function shrinkPhoto(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}
