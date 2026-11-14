// Checks screen-fps.exe against a known picture: a window over the primary display changes colour every refresh,
// every 4th refresh, then not at all. "changed/s" must follow. Run after run.ps1 has built the exe:
// node_modules/electron/dist/electron.exe tools/screen-fps/check.cjs
const { app, BrowserWindow, screen } = require('electron');
const { execFile } = require('node:child_process');
const { join, resolve } = require('node:path');

const exe = resolve(__dirname, '..', '..', 'dist-test', 'screen-fps', 'screen-fps.exe');
const page = `<!doctype html><body style="margin:0;background:#000"><script>
let every = 1, n = 0, frames = 0, t0 = performance.now();
(function f() { frames++; if (every && frames % every === 0) { n = (n + 1) % 10; const v = 40 + n * 8; document.body.style.background = 'rgb(' + v + ',' + v + ',' + v + ')'; } requestAnimationFrame(f); })();
window.phase = (e) => { every = e; frames = 0; t0 = performance.now(); };
window.rate = () => frames / ((performance.now() - t0) / 1000);
</script>`;
const measure = () => new Promise((ok, fail) => execFile(exe, ['--seconds', '4'], (err, out) => {
  if (err) return fail(err);
  const rates = [...out.matchAll(/changed\s+(\d+)\/s/g)].map((m) => Number(m[1])).slice(1);   // first second is warm-up
  ok(rates.reduce((a, b) => a + b, 0) / rates.length);
}));

app.whenReady().then(async () => {
  let fail = false;
  try {
    // Covers the centre half that screen-fps measures; soft grey steps, no bright flashing.
    const b = screen.getPrimaryDisplay().bounds;
    const d = { x: b.x + Math.round(b.width / 4), y: b.y + Math.round(b.height / 4), width: Math.round(b.width / 2), height: Math.round(b.height / 2) };
    const win = new BrowserWindow({ ...d, frame: false, alwaysOnTop: true, skipTaskbar: true, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    for (const every of [1, 4, 0]) {
      await win.webContents.executeJavaScript(`phase(${every})`);
      const changed = await measure();
      const refresh = await win.webContents.executeJavaScript('rate()');
      const want = every ? refresh / every : 0;
      const ok = every ? Math.abs(changed - want) <= Math.max(3, want * 0.1) : changed <= 1;
      if (!ok) fail = true;
      console.log(`[check] colour every ${every || 'never'}: window drew ${refresh.toFixed(1)}/s, screen-fps changed ${changed.toFixed(1)}/s, want ${want.toFixed(1)} ${ok ? 'PASS' : 'FAIL'}`);
    }
  } catch (e) { console.error(e); fail = true; }
  app.exit(fail ? 1 : 0);
});
