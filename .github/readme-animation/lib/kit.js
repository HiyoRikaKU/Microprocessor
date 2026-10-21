// Small compatibility layer for the user-supplied scene; no original kit was provided.
export const KEYS = '0123456789abcdefghijklmnopqrstuvwxyz';
export const palette = colors => Object.fromEntries(colors.map((color, i) => [KEYS[i], color]));
export function gradient(stops, count) {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return Array.from({ length: count }, (_, i) => {
    const position = i * (stops.length - 1) / (count - 1);
    const a = Math.min(stops.length - 2, Math.floor(position));
    const t = position - a;
    return '#' + rgb(stops[a]).map((c, channel) => Math.round(c + (rgb(stops[a + 1])[channel] - c) * t).toString(16).padStart(2, '0')).join('');
  });
}
export function rng(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export class Grid {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.clear(); }
  clear() { this.cells = Array.from({ length: this.cols * this.rows }, () => [' ', '7']); }
  set(x, y, char, color) {
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.cols && y < this.rows)
      this.cells[y * this.cols + x] = [char, color];
  }
  text(x, y, value, color) { Array.from(value).forEach((char, i) => this.set(x + i, y, char, color)); }
  fill(x, y, width, height, char, color) {
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) this.set(x + xx, y + yy, char, color);
  }
  box(x, y, width, height, style, color) {
    this.text(x + 1, y, '─'.repeat(width - 2), color);
    this.text(x + 1, y + height - 1, '─'.repeat(width - 2), color);
    for (let yy = 1; yy < height - 1; yy++) { this.set(x, y + yy, '│', color); this.set(x + width - 1, y + yy, '│', color); }
    this.set(x, y, '╭', color); this.set(x + width - 1, y, '╮', color);
    this.set(x, y + height - 1, '╰', color); this.set(x + width - 1, y + height - 1, '╯', color);
  }
  frame() { return this.cells; }
}
