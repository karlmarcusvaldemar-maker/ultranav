// Terrängskuggning som kartlager: räknas fram i webbläsaren ur höjddata (AWS Terrain Tiles, Terrarium).
// Kan läggas ovanpå vilken baskarta som helst. Ljus från nordväst (315°) och 45° höjd.
import { settings } from './settings.js';

const AZ = 315 * Math.PI / 180, ALT = 45 * Math.PI / 180, EXAG = 2.2; // överdriv reliefen lite för låglänt terräng

export function hillshadeLayer(opts = {}) {
  const Layer = L.GridLayer.extend({
    createTile(c, done) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 256;
      const url = settings.tiles.terrain.replace('{z}', c.z).replace('{x}', c.x).replace('{y}', c.y);
      fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then((b) => createImageBitmap(b))
        .then((bmp) => { shade(tile, bmp, c); done(null, tile); })
        .catch((e) => done(e, tile));
      return tile;
    },
  });
  return new Layer({ tileSize: 256, maxNativeZoom: 13, maxZoom: 19, minZoom: 5, opacity: 0.6, zIndex: 20, className: 'hillshade',
    attribution: 'Terrängskuggning: AWS Terrain Tiles', ...opts });
}

function shade(tile, bmp, c) {
  const W = 256, src = document.createElement('canvas');
  src.width = src.height = W;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0);
  const d = sctx.getImageData(0, 0, W, W).data;
  const h = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  // pixelstorlek i meter vid tilens mitt (Web Mercator)
  const n = 2 ** c.z, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (c.y + 0.5) / n)));
  const px = 40075016.686 * Math.cos(lat) / (W * n);
  const out = tile.getContext('2d'), img = out.createImageData(W, W), o = img.data;
  const at = (x, y) => h[Math.min(W - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dzdx = ((at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) / (8 * px) * EXAG;
      const dzdy = ((at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) / (8 * px) * EXAG;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let v = Math.cos(ALT) * Math.cos(slope) + Math.sin(ALT) * Math.sin(slope) * Math.cos(AZ - Math.PI / 2 - aspect);
      v = Math.max(0, v);
      const i = (y * W + x) * 4;
      const flat = Math.sin(ALT); // värdet för plan mark
      if (v < flat) { o[i] = o[i + 1] = o[i + 2] = 20; o[i + 3] = Math.min(190, (flat - v) * 330); } // skugga
      else { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = Math.min(90, (v - flat) * 260); }       // solsida
    }
  }
  out.putImageData(img, 0, 0);
}
