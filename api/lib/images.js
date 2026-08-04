// Build IGDB CDN image URLs.
// Docs: https://images.igdb.com/igdb/image/upload/t_{size}/{image_id}.{ext}

const CDN = 'https://images.igdb.com/igdb/image/upload';

function image(imageId, size) {
  if (!imageId) return null;
  return `${CDN}/t_${size}/${imageId}.jpg`;
}

// Covers -> t_cover_big (resized, ~264x352).
function cover(imageId) {
  return image(imageId, 'cover_big');
}

// Screenshots/artwork -> t_1080p (large, still reasonably sized).
function screenshot(imageId) {
  return image(imageId, '1080p');
}

module.exports = { image, cover, screenshot };
