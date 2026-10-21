'use strict';
const { execFile } = require('child_process');
const path = require('path');

function parsePins(text) {
  const parts = text.split(',');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,6}$/.test(p))) {
    throw new Error('GPIO_PINS 必須是四個 Linux GPIO 數字，例如 255,428,427,398');
  }
  const pins = parts.map(Number);
  if (new Set(pins).size !== 4) throw new Error('GPIO_PINS 不可重複');
  return pins;
}

class SimulationOutput {
  constructor() { this.kind = 'simulation'; this.pins = []; }
  async initialize() {}
  async write() {}
  async close() {}
}

class HardwareOutput {
  constructor(pins, options = {}) {
    this.kind = 'hardware';
    this.pins = pins;
    this.binary = options.binary || path.join(__dirname, '..', 'C++', 'gpio');
    this.env = options.env || process.env;
    this.owned = [];
  }
  call(args) {
    return new Promise((resolve, reject) => {
      execFile(this.binary, args, { timeout: 3000, maxBuffer: 16384, env: this.env }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout.trim());
      });
    });
  }
  async initialize() {
    const result = await this.call(['init', this.pins.join(',')]);
    this.owned = JSON.parse(result).owned;
  }
  async write(leds) {
    await this.call(['set', this.pins.join(','), leds.map(Number).join('')]);
  }
  async close() {
    // Only release pins exported by this instance. Existing exports stay exported.
    if (this.owned.length) await this.call(['release', this.owned.join(',')]);
  }
}
module.exports = { parsePins, SimulationOutput, HardwareOutput };
