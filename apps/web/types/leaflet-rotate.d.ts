import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    shiftKeyRotate?: boolean;
    compassBearing?: boolean;
    rotateControl?: boolean | Record<string, unknown>;
    trackContainerMutation?: boolean;
  }
  interface Map {
    setBearing(deg: number): this;
    getBearing(): number;
  }
}
