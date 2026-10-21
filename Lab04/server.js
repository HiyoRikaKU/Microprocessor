'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Controller, validate } = require('./lib/controller');
const { SimulationOutput, HardwareOutput, parsePins } = require('./lib/output');
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) reject(Object.assign(new Error('資料過大'), { status: 413 }));
      else data += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (_) { reject(Object.assign(new Error('JSON 格式錯誤'), { status: 400 })); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('連線中止')));
  });
}
function createServer(controller) {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'");
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, controller.snapshot());
      if (req.method === 'POST' && pathname === '/api/command') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: '來源不符' });
        if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return json(res, 415, { error: '請使用 application/json' });
        const command = await readBody(req);
        try { validate(command); } catch (err) { return json(res, 400, { error: err.message }); }
        if (command.action === 'reverse' && controller.snapshot().mode !== 'running') return json(res, 409, { error: '請先啟動流水燈' });
        try { return json(res, 200, await controller.dispatch(command)); }
        catch (err) { return json(res, 503, { error: err.message, state: controller.snapshot() }); }
      }
      if (req.method === 'GET' && assets[pathname]) {
        const [file, type] = assets[pathname];
        const body = await fs.promises.readFile(path.join(__dirname, 'public', file));
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
        return res.end(body);
      }
      json(res, 404, { error: '找不到路徑' });
    } catch (err) { if (!res.headersSent) json(res, err.status || 400, { error: err.message }); }
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node server.js [--hardware]\nGPIO_PINS=255,428,427,398 PORT=8080 HOST=0.0.0.0 INTERVAL_MS=500');
    return;
  }
  if (args.some(arg => arg !== '--hardware')) throw new Error('未知參數；請執行 node server.js --help');
  const port = Number(process.env.PORT || 8080);
  const interval = Number(process.env.INTERVAL_MS || 500);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必須是 1-65535');
  if (!Number.isInteger(interval) || interval < 50 || interval > 10000) throw new Error('INTERVAL_MS 必須是 50-10000');
  const output = args.includes('--hardware') ? new HardwareOutput(parsePins(process.env.GPIO_PINS || '255,428,427,398')) : new SimulationOutput();
  await output.initialize();
  const controller = new Controller(output, { interval });
  const server = createServer(controller);
  let shuttingDown = false;
  async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    const deadline = setTimeout(() => process.exit(1), 8000);
    try { await controller.close(); } catch (err) { console.error('清理失敗:', err.message); code = 1; }
    clearTimeout(deadline);
    process.exit(code);
  }
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  server.on('error', err => { console.error(err.message); shutdown(1); });
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Lab04 ${output.kind}: http://localhost:${port}`);
    if (output.kind === 'hardware') console.log('LED1-4 Linux GPIO:', output.pins.join(','));
  });
}
if (require.main === module) main().catch(err => { console.error('啟動失敗:', err.message); process.exitCode = 1; });
module.exports = { createServer };
