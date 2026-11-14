// Xenith build: main + preload (CORE), renderer (UI agent's src/renderer/main.tsx, skipped if absent).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };
mkdirSync('dist', { recursive: true });
cpSync('build/icon.png', 'dist/icon.png');

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] });

// Windows: the monitor frame counter behind the HUD's "Frames on screen" (src/main/screen-fps.ts), built with the
// C# compiler that ships with Windows. Without it the HUD simply omits that line.
const csc = `${process.env.WINDIR}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`;
if (process.platform === 'win32' && existsSync(csc)) {
  // Backslashes: csc reads a leading '/' in a path as an option.
  execFileSync(csc, ['/nologo', '/optimize', '/platform:x64', '/out:dist\\screen-fps.exe', 'tools\\screen-fps\\screen-fps.cs'], { stdio: 'inherit' });
} else if (process.platform === 'win32') {
  console.warn('[build] csc.exe not found: dist/screen-fps.exe skipped');
}

if (existsSync('src/renderer/main.tsx')) {
  mkdirSync('dist/renderer', { recursive: true });
  await build({
    ...common,
    entryPoints: ['src/renderer/main.tsx'], outfile: 'dist/renderer/main.js', platform: 'browser', format: 'iife',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.jpg': 'file', '.svg': 'file' },
    assetNames: 'assets/[name]-[hash]',
  });
  if (existsSync('src/renderer/index.html')) cpSync('src/renderer/index.html', 'dist/renderer/index.html');
  else console.warn('[build] src/renderer/index.html not found — dist/renderer/index.html not updated');
} else {
  console.warn('[build] src/renderer/main.tsx not found — renderer build skipped (provided by the UI agent)');
}
