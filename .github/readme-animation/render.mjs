import create, { meta } from './scenes/subtitle-captions.js';
const scene = create();
// GIF delays use hundredths of a second: 80 ms/frame = 12.5 fps, 26.4 s total.
process.stdout.write(JSON.stringify({ ...meta, durationMs: 80, frames: Array.from({length:330}, (_, i) => scene(i * .08)) }));
