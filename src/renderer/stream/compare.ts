// Second-monitor reference window for a Lossless Scaling comparison. It is opened from this renderer, so it shows
// the same decoded picture in-process: no re-encoding, no second Xbox session, no input. The main process places it
// full screen on another monitor (setWindowOpenHandler in main.ts).
let win: Window | null = null;
let timer: number | null = null;
const captures = new WeakMap<HTMLCanvasElement, MediaStream>();

/** What the main window shows right now: the processing canvas (sharpening, FSR, dedupe) or the plain video. */
function shownElement(container: HTMLElement): HTMLCanvasElement | HTMLVideoElement | null {
  const visible = (el: HTMLElement) => { const s = getComputedStyle(el); return s.display !== 'none' && s.opacity !== '0'; };
  const canvas = [...container.querySelectorAll('canvas')].find(visible);
  if (canvas) return canvas;
  const video = container.querySelector('video');
  return video && visible(video) ? video : null;
}

function streamOf(el: HTMLCanvasElement | HTMLVideoElement): MediaStream | null {
  if (el instanceof HTMLVideoElement) return el.srcObject instanceof MediaStream ? el.srcObject : null;
  let s = captures.get(el);
  if (!s) { s = el.captureStream(); captures.set(el, s); }
  return s;
}

export function stopComparison(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  win?.close();
  win = null;
}

export function startComparison(container: HTMLElement, label: string): 'opened' | 'no-display' {
  stopComparison();
  const w = window.open('about:blank', 'jadebox-compare');
  if (!w) return 'no-display';
  win = w;
  const d = w.document;
  d.title = `Jadebox — ${label}`;
  d.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
  const video = d.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.style.cssText = 'display:block;width:100vw;height:100vh';
  const tag = d.createElement('div');
  tag.textContent = label;
  tag.style.cssText = 'position:fixed;left:20px;top:20px;padding:8px 12px;border-radius:8px;background:rgba(11,16,24,.78);color:#fff;font:14px system-ui,sans-serif';
  d.body.append(video, tag);
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopComparison(); });

  let source: Element | null = null;
  const sync = () => {
    if (w.closed) { stopComparison(); return; }
    // The main window swaps canvases when the picture mode changes, so the source is re-checked.
    const el = shownElement(container);
    if (el !== source) {
      source = el;
      video.srcObject = el ? streamOf(el) : null;
      void video.play().catch(() => undefined);
    }
    video.style.objectFit = el?.style.objectFit || 'contain';
    video.style.filter = container.querySelector<HTMLElement>('.xenith-stream')?.style.filter ?? '';
  };
  sync();
  timer = window.setInterval(sync, 250);
  return 'opened';
}
