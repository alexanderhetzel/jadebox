// Checks the real stream/compare.ts against a synthetic stream: the second window must receive every frame of
// whatever the main window shows (a WebGL canvas without preserveDrawingBuffer, like sharpening, then the plain
// video), and window.open denial must report 'no-display'. Windows are visible: hidden ones stop drawing.
// Run: node_modules/electron/dist/electron.exe tools/ui-preview/check-compare.cjs
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..', '..');
const out = join(__dirname, 'dist');
mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'compare-test-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
buildSync({ entryPoints: [join(root, 'src', 'renderer', 'stream', 'compare.ts')], outfile: join(out, 'compare-source.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'Compare' });
writeFileSync(join(out, 'compare-source.html'), `<!doctype html><meta charset="utf-8">
<div class="stream__video"><div class="xenith-stream" style="filter: brightness(1.1)">
<video autoplay muted playsinline style="opacity:0;object-fit:contain"></video><canvas width="640" height="360" style="object-fit:contain"></canvas></div></div>
<canvas id="src" width="640" height="360" hidden></canvas>
<script src="compare-source.js"></script><script>
// Plain video: green square moving on dark grey. Processing canvas: red channel ramps every frame.
const src = document.getElementById('src'), s2d = src.getContext('2d'), video = document.querySelector('video');
let n = 0;
setInterval(() => { s2d.fillStyle = '#111'; s2d.fillRect(0, 0, 640, 360); s2d.fillStyle = '#0f0'; s2d.fillRect((n++ * 5) % 640, 150, 60, 60); }, 16);
video.srcObject = src.captureStream(60); void video.play();
const canvas = document.querySelector('.xenith-stream canvas'), gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false, alpha: false });
let t = 0; (function draw() { t++; gl.clearColor((t % 60) / 60, 0.5, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(draw); })();
const container = document.querySelector('.stream__video');
const sample = (seconds) => new Promise((done) => {
  const w = window.open('', 'jadebox-compare'), v = w.document.querySelector('video');
  const c = w.document.createElement('canvas'); c.width = 64; c.height = 36; const ctx = c.getContext('2d', { willReadFrequently: true });
  let frames = 0; const seen = new Set(); let px = [0, 0, 0];
  const cb = () => { frames++; ctx.drawImage(v, 0, 0, 64, 36); px = [...ctx.getImageData(32, 18, 1, 1).data.slice(0, 3)]; seen.add(px.join()); v.requestVideoFrameCallback(cb); };
  v.requestVideoFrameCallback(cb);
  setTimeout(() => done({ frames, distinct: seen.size, last: px, filter: v.style.filter, size: v.videoWidth + 'x' + v.videoHeight }), seconds * 1000);
});
window.run = async () => {
  const opened = Compare.startComparison(container, 'No frame generation');
  await new Promise((r) => setTimeout(r, 500));
  const canvasPhase = await sample(1);
  canvas.style.display = 'none'; video.style.opacity = '1';
  await new Promise((r) => setTimeout(r, 600));
  const videoPhase = await sample(1);
  Compare.stopComparison();
  return { opened, canvasPhase, videoPhase };
};
</script>`);

app.whenReady().then(async () => {
  let fail = false;
  const check = (ok, what) => { console.log(`[check] ${what} ${ok ? 'PASS' : 'FAIL'}`); if (!ok) fail = true; };
  try {
    const main = new BrowserWindow({ x: 20, y: 40, width: 660, height: 400, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    let allow = true;
    main.webContents.setWindowOpenHandler(({ url, frameName }) => allow && url === 'about:blank' && frameName === 'jadebox-compare'
      ? { action: 'allow', overrideBrowserWindowOptions: { x: 700, y: 40, width: 660, height: 400, backgroundColor: '#000000' } }
      : { action: 'deny' });
    await main.loadFile(join(out, 'compare-source.html'));
    await new Promise((r) => setTimeout(r, 800));
    const r = await main.webContents.executeJavaScript('run()', true);
    console.log(JSON.stringify(r));
    check(r.opened === 'opened', 'window opened');
    check(r.canvasPhase.frames >= 40 && r.canvasPhase.distinct >= 20, 'canvas frames reach the second window');
    check(r.canvasPhase.size === '640x360', 'canvas picture keeps full size');
    check(r.canvasPhase.filter === 'brightness(1.1)', 'picture filter is copied');
    check(r.videoPhase.frames >= 30 && r.videoPhase.last[1] < 60, 'switches to the plain video when the canvas hides');
    allow = false;
    check(await main.webContents.executeJavaScript(`Compare.startComparison(document.querySelector('.stream__video'), 'x')`) === 'no-display', 'no second monitor reports no-display');
  } catch (e) { console.error(e); fail = true; }
  app.exit(fail ? 1 : 0);
});
