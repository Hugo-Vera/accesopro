export function mediaDevicesAvailable() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export async function getCameraStream(constraints: MediaStreamConstraints) {
  if (!mediaDevicesAvailable()) {
    throw new Error("La cámara no está disponible. Usá HTTPS o localhost, o el lector HID.");
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}
