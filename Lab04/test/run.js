'use strict';
// Dependency-free tests; run on the same Node.js version as the application.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Controller } = require('../lib/controller');
const { SimulationOutput, HardwareOutput, parsePins } = require('../lib/output');
const { createServer } = require('../server');
const tests = [];
function test(name, run) { tests.push({ name, run }); }
class Clock {
  constructor() { this.pending = new Map(); this.id = 0; }
  setTimeout(fn) { const id = ++this.id; this.pending.set(id, fn); return id; }
  clearTimeout(id) { this.pending.delete(id); }
  async step(controller) {
    assert.strictEqual(this.pending.size, 1, 'exactly one animation timer');
    const [id, fn] = this.pending.entries().next().value;
    this.pending.delete(id); fn();
    await controller.queue;
  }
}
function fixture(output = new SimulationOutput()) {
  const clock = new Clock();
  return { c: new Controller(output, { clock }), clock };
}
function request(server, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path: pathname,
      headers: Object.assign(body === undefined ? {} : { 'Content-Type': 'application/json' }, headers) }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
test('指定開關保留未勾選的 LED，同頁狀態含送出結果', async () => {
  const { c } = fixture();
  await c.dispatch({ action: 'manual', leds: [1, 3], on: true });
  await c.dispatch({ action: 'manual', leds: [1], on: false });
  assert.deepStrictEqual(c.snapshot().leds, [false, false, true, false]);
  assert.strictEqual(c.snapshot().message, 'LED1 OFF');
  await c.close();
});
test('Mode_Shine 5 輪：兩組各亮 5 次，結束全部熄滅', async () => {
  const frames = [];
  const output = new SimulationOutput(); output.write = async leds => { frames.push(leds.map(Number).join('')); };
  const { c, clock } = fixture(output);
  await c.dispatch({ action: 'shine', count: 5 });
  for (let i = 0; i < 10; i++) await clock.step(c);
  assert.deepStrictEqual(frames, ['1010','0101','1010','0101','1010','0101','1010','0101','1010','0101','0000']);
  assert.strictEqual(c.snapshot().completed, 5);
  assert.strictEqual(c.snapshot().mode, 'idle');
  assert.strictEqual(clock.pending.size, 0);
  await c.close();
});
test('Submit 一次套用混合亮滅、取消動畫並保留送出快照', async () => {
  const frames = [];
  const output = new SimulationOutput(); output.write = async leds => { frames.push(leds); };
  const { c, clock } = fixture(output);
  await c.dispatch({ action: 'run' });
  const states = [true, false, true, false];
  const pending = c.dispatch({ action: 'manual', states });
  states.fill(false);
  await pending;
  assert.deepStrictEqual(c.snapshot().leds, [true, false, true, false]);
  assert.strictEqual(c.snapshot().mode, 'manual');
  assert.strictEqual(clock.pending.size, 0);
  assert.strictEqual(frames.length, 2, 'one output write per command');
  await c.close();
});
test('閃爍接受 1 與 100，拒絕範圍外設定且不打斷動畫', async () => {
  const { c, clock } = fixture();
  await c.dispatch({ action: 'shine', count: 1 });
  await c.dispatch({ action: 'shine', count: 100 });
  for (const count of [0, 101, 1.5]) assert.throws(() => c.dispatch({ action: 'shine', count }));
  assert.strictEqual(c.snapshot().requested, 100);
  assert.strictEqual(clock.pending.size, 1);
  await c.close();
});
test('流水燈循環、途中反轉保持當前 LED，下一步反方向', async () => {
  const { c, clock } = fixture();
  await c.dispatch({ action: 'run' });
  for (let i = 1; i <= 4; i++) { await clock.step(c); assert.strictEqual(c.snapshot().leds.indexOf(true), i % 4); }
  await c.dispatch({ action: 'reverse' });
  assert.strictEqual(c.snapshot().leds.indexOf(true), 0);
  await clock.step(c); assert.strictEqual(c.snapshot().leds.indexOf(true), 3);
  await c.dispatch({ action: 'reverse' });
  await clock.step(c); assert.strictEqual(c.snapshot().leds.indexOf(true), 0);
  await c.dispatch({ action: 'stop' });
  assert.deepStrictEqual(c.snapshot().leds, [false,false,false,false]);
  assert.strictEqual(clock.pending.size, 0);
  await c.close();
});
test('模式切換取消舊計時器，無效輸入不影響動畫', async () => {
  const { c, clock } = fixture();
  await c.dispatch({ action: 'shine', count: 1 });
  const stale = Array.from(clock.pending.values())[0];
  assert.throws(() => c.dispatch({ action: 'shine', count: 0 }));
  assert.strictEqual(c.snapshot().mode, 'shine');
  await c.dispatch({ action: 'run' }); stale(); await c.queue;
  assert.strictEqual(c.snapshot().leds.indexOf(true), 0);
  assert.strictEqual(clock.pending.size, 1);
  await c.dispatch({ action: 'manual', leds: [2], on: true });
  assert.strictEqual(clock.pending.size, 0);
  assert.deepStrictEqual(c.snapshot().leds, [true,true,false,false]);
  await c.close();
});
test('GPIO 寫入失敗停止動畫，無法熄滅時標為未知，停止可重試', async () => {
  const output = new SimulationOutput(); let broken = false;
  output.write = async () => { if (broken) throw new Error('device failed'); };
  const { c, clock } = fixture(output);
  await c.dispatch({ action: 'run' }); broken = true;
  await clock.step(c);
  assert.strictEqual(c.snapshot().mode, 'error');
  assert.strictEqual(c.snapshot().outputKnown, false);
  assert.strictEqual(clock.pending.size, 0);
  broken = false; await c.dispatch({ action: 'stop' });
  assert.strictEqual(c.snapshot().outputKnown, true);
  assert.strictEqual(c.snapshot().error, null);
  await c.close();
});
test('多個同時操作序列化，GPIO 寫入不重疊', async () => {
  const output = new SimulationOutput(); let busy = false;
  output.write = async () => { assert.strictEqual(busy, false); busy = true; await new Promise(resolve => setTimeout(resolve, 3)); busy = false; };
  const { c } = fixture(output);
  await Promise.all([c.dispatch({ action: 'run' }), c.dispatch({ action: 'shine', count: 2 }), c.dispatch({ action: 'stop' })]);
  assert.strictEqual(c.snapshot().mode, 'idle');
  await c.close();
});
test('HTTP 網頁、API、輸入驗證與錯誤狀態', async () => {
  const { c } = fixture(); const server = createServer(c);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const page = await request(server, 'GET', '/');
    assert.strictEqual(page.status, 200);
    for (const label of ['Submit','Mode_Shine','Running Light on','Running Light off','Change Direction']) assert(page.text.includes(label));
    for (const asset of ['/app.js', '/style.css', '/api/state']) assert.strictEqual((await request(server, 'GET', asset)).status, 200);
    const result = await request(server, 'POST', '/api/command', { action: 'manual', leds: [2,4], on: true });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(JSON.parse(result.text).leds, [false,true,false,true]);
    const mixed = await request(server, 'POST', '/api/command', {action:'manual',states:[true,false,true,false]});
    assert.strictEqual(mixed.status, 200);
    assert.deepStrictEqual(JSON.parse(mixed.text).leds, [true,false,true,false]);
    const invalid = [{action:'manual',states:[]},{action:'manual',states:[true,false,true,'false']},{action:'manual',states:[true,false,true,false],leds:[1],on:true},{action:'manual',leds:[],on:true},{action:'manual',leds:[1,1],on:true},{action:'manual',leds:[1],on:'true'},{action:'shine',count:1.5},{action:'shine',count:101},{action:'$(touch BAD)'},null,[], 'bad json'];
    for (const input of invalid) assert.strictEqual((await request(server, 'POST', '/api/command', input)).status, 400);
    assert.strictEqual((await request(server, 'POST', '/api/command', {action:'reverse'})).status, 409);
    assert.strictEqual((await request(server, 'POST', '/api/command', {action:'stop'}, {'Content-Type':'text/plain'})).status, 415);
    assert.strictEqual((await request(server, 'POST', '/api/command', {action:'stop'}, {Origin:'http://other.example'})).status, 403);
    assert.strictEqual((await request(server, 'POST', '/api/command', 'x'.repeat(5000))).status, 413);
    assert.strictEqual((await request(server, 'GET', '/server.js')).status, 404);
    c.output.write = async () => { throw new Error('hardware unavailable'); };
    assert.strictEqual((await request(server, 'POST', '/api/command', {action:'stop'})).status, 503);
    c.output.write = async () => {};
  } finally { await c.close(); await new Promise(resolve => server.close(resolve)); }
});
test('GPIO 配置拒絕重複、缺漏、shell 字串', async () => {
  assert.deepStrictEqual(parsePins('255,428,427,398'), [255,428,427,398]);
  for (const input of ['1,2,3','1,1,2,3','1,2,3,4;ls','-1,2,3,4','1,2,3,4,5']) assert.throws(() => parsePins(input));
});
test('C++ 編譯、execFile 串接與暫存 sysfs 檔案寫入（非實體硬體）', async () => {
  const build = spawnSync('make', ['-C', path.join(__dirname, '..', 'C++')], { encoding: 'utf8' });
  assert.strictEqual(build.status, 0, build.stderr + build.stdout);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab04-gpio-'));
  const pins = [255,428,427,398];
  const binary = path.join(__dirname, '..', 'C++', 'gpio');
  const env = Object.assign({}, process.env, {GPIO_SYSFS_ROOT: root});
  const output = new HardwareOutput(pins, { env });
  let c;
  try {
    for (const pin of pins) {
      fs.mkdirSync(path.join(root, `gpio${pin}`));
      for (const file of ['direction','value']) fs.writeFileSync(path.join(root, `gpio${pin}`, file), file === 'direction' ? 'in\n' : '0');
    }
    fs.writeFileSync(path.join(root, 'unexport'), 'untouched');
    await output.initialize();
    assert.deepStrictEqual(output.owned, []);
    c = fixture(output).c;
    await c.dispatch({action:'manual',leds:[1,3],on:true});
    const readValues = () => pins.map(pin => fs.readFileSync(path.join(root, `gpio${pin}`, 'value'), 'utf8'));
    assert.deepStrictEqual(readValues(), ['1','0','1','0']);
    const bad = spawnSync(binary, ['set', pins.join(','), '111;'], {env, encoding:'utf8'});
    assert.strictEqual(bad.status, 1);
    assert.deepStrictEqual(readValues(), ['1','0','1','0']);
    await c.close(); c = null;
    assert.deepStrictEqual(readValues(), ['0','0','0','0']);
    assert.strictEqual(fs.readFileSync(path.join(root,'unexport'),'utf8'), 'untouched');
    await output.write([true,true,true,true]);
    fs.unlinkSync(path.join(root, 'gpio255', 'value'));
    await assert.rejects(output.write([false,false,false,false]));
    for (const pin of pins.slice(1)) assert.strictEqual(fs.readFileSync(path.join(root,`gpio${pin}`,'value'),'utf8'), '0');
    assert.strictEqual(fs.existsSync(path.join(root, 'gpio255', 'value')), false, 'missing sysfs values are never created');
  } finally {
    if (c) await c.close().catch(() => {});
    // Node 12 compatibility: remove this small, known fixture without recursive rm.
    for (const pin of pins) {
      for (const file of ['direction','value']) { try { fs.unlinkSync(path.join(root,`gpio${pin}`,file)); } catch (_) {} }
      fs.rmdirSync(path.join(root,`gpio${pin}`));
    }
    fs.unlinkSync(path.join(root,'unexport')); fs.rmdirSync(root);
  }
});
(async () => {
  let failed = 0;
  for (const item of tests) {
    try { await item.run(); console.log('PASS', item.name); }
    catch (err) { failed++; console.error('FAIL', item.name, '\n', err); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
