// Runs screen-fps.exe (tools/screen-fps, built into dist/ by build.mjs on Windows) on the monitor that shows the
// Jadebox window and forwards its "changed/s" — pictures that actually reached the screen — to the renderer HUD.
import { app, screen, type BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './events';
import { logWarn } from './log';

let proc: ChildProcess | null = null;

/** Packaged: resources/app.asar.unpacked/dist (an exe cannot run from inside the asar). Dev: <repo>/dist. */
const exePath = () => join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'dist', 'screen-fps.exe');

export function setScreenFps(on: boolean, win: BrowserWindow | null): void {
  if (!on || process.platform !== 'win32' || !win || win.isDestroyed()) { proc?.kill(); proc = null; return; }
  if (proc) return;
  const exe = exePath();
  if (!existsSync(exe)) { logWarn('screenfps.missing', exe); return; }
  const b = win.getBounds();
  const c = screen.dipToScreenPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const p = spawn(exe, ['--at', `${Math.round(c.x)},${Math.round(c.y)}`], { windowsHide: true });
  proc = p;
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (chunk: string) => {
    buf += chunk;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const m = /changed\s+(\d+)\/s/.exec(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m) emit({ type: 'screenFps', changed: Number(m[1]) });
    }
  });
  p.stderr.setEncoding('utf8');
  p.stderr.on('data', (d: string) => logWarn('screenfps.stderr', d.trim().slice(0, 300)));
  p.on('error', (e) => logWarn('screenfps.error', String(e)));
  p.on('exit', (code) => { if (proc === p) proc = null; if (code) logWarn('screenfps.exit', code); });
}
