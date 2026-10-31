export class MapViewport {
  zoom = 1.6;
  x = 0.5;
  y = 0.5;
  constructor(readonly bounds: number[]) {}
  get box() {
    const [left, top, width, height] = this.bounds;
    return [
      left + (this.x - 0.5 / this.zoom) * width,
      top + (this.y - 0.5 / this.zoom) * height,
      width / this.zoom,
      height / this.zoom,
    ];
  }
  private clamp() {
    const half = 0.5 / this.zoom;
    this.x = Math.min(1 - half, Math.max(half, this.x));
    this.y = Math.min(1 - half, Math.max(half, this.y));
  }
  scale(value: number) {
    this.zoom = Math.min(4, Math.max(1, value));
    this.clamp();
  }
  center(point: number[]) {
    this.x = (point[0] - this.bounds[0]) / this.bounds[2];
    this.y = (point[1] - this.bounds[1]) / this.bounds[3];
    this.clamp();
  }
  pan(dx: number, dy: number, pixelsWide: number, pixelsHigh: number) {
    this.x -= dx / pixelsWide / this.zoom;
    this.y -= dy / pixelsHigh / this.zoom;
    this.clamp();
  }
  reset() {
    this.zoom = 1;
    this.x = this.y = 0.5;
  }
}
