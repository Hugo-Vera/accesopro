export function cameraHttpsUrl() {
  if (typeof window === "undefined") return "";
  const { hostname, pathname, search, hash } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return window.location.href;
  return `https://${hostname}:3443${pathname}${search}${hash}`;
}

export function cameraNeedsHttps() {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

export function cameraBlockReason(): string | null {
  if (typeof navigator === "undefined") return "La cámara no está disponible.";
  if (cameraNeedsHttps()) {
    return `El navegador bloquea la cámara en HTTP. Entrá por ${cameraHttpsUrl()} (aceptá el certificado una vez) o usá el lector USB.`;
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return "La cámara no está disponible. Pasá el DNI por el lector USB.";
  }
  return null;
}

export function mediaDevicesAvailable() {
  return cameraBlockReason() === null;
}

export async function getCameraStream(constraints: MediaStreamConstraints) {
  const reason = cameraBlockReason();
  if (reason) throw new Error(reason);
  return navigator.mediaDevices.getUserMedia(constraints);
}
