'use strict';
const OFF = [false, false, false, false];

function validate(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('需要 JSON 物件');
  if (!['manual', 'shine', 'run', 'stop', 'reverse'].includes(command.action)) throw new Error('未知操作');
  if (command.action === 'manual') {
    if (Object.prototype.hasOwnProperty.call(command, 'states')) {
      if (!Array.isArray(command.states) || command.states.length !== 4 ||
          command.states.some(on => typeof on !== 'boolean') ||
          'leds' in command || 'on' in command) {
        throw new Error('請提供四顆 LED 的布林狀態');
      }
    } else if (!Array.isArray(command.leds) || !command.leds.length || command.leds.length > 4 ||
        command.leds.some(n => !Number.isInteger(n) || n < 1 || n > 4) ||
        new Set(command.leds).size !== command.leds.length || typeof command.on !== 'boolean') {
      throw new Error('請選擇 LED1-4，並指定 ON 或 OFF');
    }
  }
  if (command.action === 'shine' && (!Number.isInteger(command.count) || command.count < 1 || command.count > 100)) {
    throw new Error('閃爍次數必須是 1-100 的整數');
  }
}

class Controller {
  constructor(output, options = {}) {
    this.output = output;
    this.interval = options.interval || 500;
    this.clock = options.clock || { setTimeout, clearTimeout };
    this.queue = Promise.resolve();
    this.timer = null;
    this.generation = 0;
    this.closed = false;
    this.state = { leds: OFF.slice(), mode: 'idle', direction: 1, current: 0,
      requested: 0, completed: 0, phase: 0, message: '已就緒', error: null, outputKnown: true };
  }
  snapshot() {
    return Object.assign({}, this.state, { leds: this.state.leds.slice(),
      backend: this.output.kind, pins: this.output.pins.slice(), intervalMs: this.interval });
  }
  enqueue(work) {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  cancel() {
    this.generation++;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
  async apply(leds) {
    await this.output.write(leds.slice());
    this.state.leds = leds.slice();
    this.state.outputKnown = true;
  }
  async fail(err) {
    this.cancel();
    this.state.mode = 'error';
    this.state.error = err.message;
    this.state.message = 'GPIO 操作失敗，動畫已停止';
    this.state.outputKnown = false;
    try { await this.apply(OFF); } catch (_) { /* Cannot confirm electrical state. */ }
  }
  schedule() {
    if (this.closed) return;
    const generation = this.generation;
    this.timer = this.clock.setTimeout(() => {
      if (generation === this.generation) this.timer = null;
      this.enqueue(async () => {
        if (generation !== this.generation || this.closed) return;
        try { await this.tick(); } catch (err) { await this.fail(err); }
      });
    }, this.interval);
  }
  async tick() {
    const s = this.state;
    if (s.mode === 'running') {
      s.current = (s.current + s.direction + 4) % 4;
      await this.apply(OFF.map((_, i) => i === s.current));
    } else if (s.mode === 'shine') {
      if (s.phase === 1) {
        s.completed++;
        if (s.completed === s.requested) {
          await this.apply(OFF);
          s.mode = 'idle';
          s.message = `Mode_Shine 完成 ${s.completed} 輪`;
          return;
        }
      }
      s.phase = 1 - s.phase;
      await this.apply(s.phase === 0 ? [true, false, true, false] : [false, true, false, true]);
    } else return;
    this.schedule();
  }
  dispatch(command) {
    // Validate before enqueuing: malformed requests cannot interrupt animation.
    validate(command);
    // Copy caller-owned arrays before queued writes to preserve the submitted settings.
    command = Object.assign({}, command);
    if (command.states) command.states = command.states.slice();
    if (command.leds) command.leds = command.leds.slice();
    return this.enqueue(async () => {
      if (this.closed) throw new Error('伺服器正在關閉');
      const s = this.state;
      if (command.action === 'reverse') {
        if (s.mode !== 'running') throw new Error('請先啟動流水燈');
        s.direction *= -1;
        s.message = '已反轉流水燈方向';
        return this.snapshot();
      }
      this.cancel();
      try {
        if (command.action === 'manual') {
          const next = command.states ? command.states.slice() : s.leds.slice();
          if (!command.states) command.leds.forEach(n => { next[n - 1] = command.on; });
          await this.apply(next);
          s.mode = 'manual';
          s.message = command.states ? 'LED 設定已套用' : command.leds.map(n => `LED${n} ${command.on ? 'ON' : 'OFF'}`).join('、');
        } else if (command.action === 'shine') {
          s.requested = command.count; s.completed = 0; s.phase = 0;
          await this.apply([true, false, true, false]);
          s.mode = 'shine';
          s.message = `Mode_Shine_Times: ${command.count}`;
        } else if (command.action === 'run') {
          s.current = 0; s.direction = 1;
          await this.apply([true, false, false, false]);
          s.mode = 'running';
          s.message = '流水燈已啟動';
        } else {
          await this.apply(OFF);
          s.mode = 'idle';
          s.message = '已停止，全部 LED OFF';
        }
        s.error = null;
        if (['shine', 'running'].includes(s.mode)) this.schedule();
        return this.snapshot();
      } catch (err) {
        await this.fail(err);
        throw err;
      }
    });
  }
  async close() {
    this.closed = true;
    this.cancel();
    return this.enqueue(async () => {
      let failure;
      try { await this.apply(OFF); } catch (err) { failure = err; }
      try { await this.output.close(); } catch (err) { failure = failure || err; }
      if (failure) throw failure;
    });
  }
}
module.exports = { Controller, validate };
