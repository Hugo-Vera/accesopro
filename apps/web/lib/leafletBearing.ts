/** Giro del plano. Leaflet no trae bearing; rotamos el mapPane y compensamos el clic. */

export function normalizeBearing(deg: number) {
  if (!Number.isFinite(deg)) return 0;
  return ((Math.round(deg) % 360) + 360) % 360;
}

export type BearingMap = import("leaflet").Map & {
  setBearing: (deg: number) => BearingMap;
  getBearing: () => number;
};

type LeafletNS = typeof import("leaflet");

const paneApply = new WeakMap<HTMLElement, () => void>();
let patched: LeafletNS | null = null;
let origSetPosition: (typeof import("leaflet").DomUtil)["setPosition"] | null = null;
let patchUsers = 0;

function patchDomUtil(L: LeafletNS) {
  if (patched === L) return;
  origSetPosition = L.DomUtil.setPosition;
  L.DomUtil.setPosition = function (el, point) {
    origSetPosition!.call(this, el, point);
    paneApply.get(el)?.();
  };
  patched = L;
}

function unpatchDomUtil(L: LeafletNS) {
  if (patched !== L || !origSetPosition) return;
  L.DomUtil.setPosition = origSetPosition;
  patched = null;
  origSetPosition = null;
}

export function attachMapBearing(L: LeafletNS, map: import("leaflet").Map, initial = 0): BearingMap {
  const bearingMap = map as BearingMap;
  let bearing = normalizeBearing(initial);
  const origMouse = map.mouseEventToContainerPoint.bind(map);

  function apply() {
    const pane = map.getPane("mapPane");
    if (!pane) return;
    const pos = (map as unknown as { _getMapPanePos: () => { x: number; y: number } })._getMapPanePos();
    const size = map.getSize();
    pane.style.transformOrigin = `${-pos.x + size.x / 2}px ${-pos.y + size.y / 2}px`;
    pane.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) rotate(${bearing}deg)`;
  }

  patchDomUtil(L);
  patchUsers += 1;
  const pane = map.getPane("mapPane");
  if (pane) paneApply.set(pane, apply);

  map.mouseEventToContainerPoint = function (e) {
    const p = origMouse(e);
    if (!bearing) return p;
    const size = map.getSize();
    const cx = size.x / 2;
    const cy = size.y / 2;
    const rad = (-bearing * Math.PI) / 180;
    const dx = p.x - cx;
    const dy = p.y - cy;
    return L.point(cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad));
  };

  bearingMap.setBearing = (deg: number) => {
    bearing = normalizeBearing(deg);
    apply();
    return bearingMap;
  };
  bearingMap.getBearing = () => bearing;

  map.on("move zoom viewreset", apply);
  apply();

  map.once("unload", () => {
    map.off("move zoom viewreset", apply);
    map.mouseEventToContainerPoint = origMouse;
    if (pane) paneApply.delete(pane);
    patchUsers -= 1;
    if (patchUsers <= 0) {
      patchUsers = 0;
      unpatchDomUtil(L);
    }
  });

  return bearingMap;
}
