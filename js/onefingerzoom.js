// Enhandszoom som i Google Maps: dubbeltryck och håll kvar, dra nedåt = zooma in, uppåt = zooma ut.
// Ett vanligt dubbeltryck utan att dra zoomar in ett steg, som förut. Avstängt när rutt läggs ut eller ritas
// (där betyder två snabba tryck två punkter).

let gestureAt = 0;
/** Tid för senaste zoomgest — kartans tryck-hantering hoppar över info-rutan för det första trycket i gesten */
export const lastZoomGesture = () => gestureAt;

export function initOneFingerZoom(map, { enabled, aroundCenter }) {
  const el = map.getContainer();
  let lastTap = 0, lastXY = null, active = null; // active: { y0, z0, pt, moved, snap }
  const opts = { capture: true, passive: false };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !enabled()) { lastTap = 0; if (active) end(e); return; }
    const t = e.touches[0], now = Date.now();
    if (now - lastTap < 320 && lastXY && Math.hypot(t.clientX - lastXY.x, t.clientY - lastXY.y) < 40) {
      const r = el.getBoundingClientRect();
      active = { y0: t.clientY, z0: map.getZoom(), pt: L.point(t.clientX - r.left, t.clientY - r.top), moved: false, snap: map.options.zoomSnap };
      gestureAt = now; lastTap = 0;
      map.closePopup();          // första trycket kan ha öppnat en info-ruta
      map.dragging.disable();
      map.options.zoomSnap = 0;  // mjuk zoom medan fingret drar
      stop(e);
      return;
    }
    lastTap = now; lastXY = { x: t.clientX, y: t.clientY };
  }, opts);

  el.addEventListener('touchmove', (e) => {
    if (!active) return;
    const dy = e.touches[0].clientY - active.y0;
    if (Math.abs(dy) > 6) active.moved = true;
    if (active.moved) {
      gestureAt = Date.now();
      const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), active.z0 + dy / 110));
      if (aroundCenter()) map.setZoom(z, { animate: false }); // följer flygplanet: behåll det i bild
      else map.setZoomAround(active.pt, z, { animate: false });
    }
    stop(e);
  }, opts);

  function end(e) {
    if (!active) return;
    const a = active; active = null;
    map.options.zoomSnap = a.snap;
    map.dragging.enable();
    if (!a.moved) { // vanligt dubbeltryck: ett steg in
      if (aroundCenter()) map.zoomIn(); else map.setZoomAround(a.pt, a.z0 + 1);
    } else {
      const z = Math.round(map.getZoom() / a.snap) * a.snap; // landa på ett jämnt zoomsteg
      if (aroundCenter()) map.setZoom(z, { animate: false }); else map.setZoomAround(a.pt, z, { animate: false });
    }
    gestureAt = Date.now();
    if (e?.cancelable) stop(e);
  }
  el.addEventListener('touchend', end, opts);
  el.addEventListener('touchcancel', end, opts);
}
