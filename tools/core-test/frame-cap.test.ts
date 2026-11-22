import test from 'node:test';
import assert from 'node:assert/strict';
import { PostProcessor, type PostConfig } from '../../src/renderer/stream/postprocess';
import { type DedupeStats } from '../../src/renderer/stream/dedupe';

// Drive the actual video callback. Count WebGL calls without depending on display refresh or GPU timing.
function playback() {
  const calls = { uploads: 0, draws: 0, reads: 0 };
  const gl = new Proxy({
    texSubImage2D() { calls.uploads++; },
    drawArrays() { calls.draws++; },
    readPixels() { calls.reads++; }, // unchanged pixels
  }, { get(target, key) { return target[key] ?? (() => true); } });
  const canvas = { style: {}, addEventListener() {}, getContext: () => gl };
  Object.assign(globalThis, {
    document: { createElement: () => canvas },
    ResizeObserver: class { observe() {} },
    window: { setInterval(fn: () => void) { flush = fn; return 1; } },
  });
  let callback: VideoFrameRequestCallback;
  let flush: () => void;
  let stats: DedupeStats;
  const video = {
    videoWidth: 640, videoHeight: 360, style: {}, addEventListener() {},
    requestVideoFrameCallback(fn: VideoFrameRequestCallback) { callback = fn; return 1; },
  };
  const holder = { style: {}, appendChild() {} };
  const post = new PostProcessor(holder as unknown as HTMLElement, video as unknown as HTMLVideoElement, {},
    (event, data) => { if (event === 'post.dedupe') stats = data as DedupeStats; });
  post.setReady();
  const config: PostConfig = { cap: 0, dedupe: true, fit: 'contain', sharpness: 0, fsr: false,
    bridge: false, brightness: 1, contrast: 1, saturation: 1 };
  return {
    calls,
    configure(cap: number, dedupe = true) { post.apply({ ...config, cap, dedupe }); },
    frame(mediaTime: number) { callback(0, { mediaTime } as VideoFrameCallbackMetadata); },
    stats() { flush(); return stats; },
  };
}

for (const cap of [30, 24]) {
  for (const rate of [60, 36, 20]) {
    for (const dedupe of [false, true]) {
      test(`cap ${cap}, ${rate} callbacks/s, Drop repeated frames ${dedupe}`, () => {
        const player = playback();
        player.configure(cap, dedupe);
        for (let i = 0; i < rate; i++) player.frame(13 + Math.round(i / rate * 1e6) / 1e6);
        const drawn = Math.min(cap, rate);
        assert.deepEqual(player.calls, { uploads: drawn, draws: drawn, reads: 0 });
        const stats = player.stats();
        assert.deepEqual([stats.frames, stats.drawn, stats.skipped], [rate, drawn, rate - drawn]);
      });
    }
  }
}

test('missed slots expire, and backward or large forward jumps anchor a new grid', () => {
  const player = playback();
  player.configure(30);
  for (const [time, draws] of [
    [5, 1], [5, 1], [5.01, 1], [5.201, 2], [5.202, 2], [5.234, 3],
    [2, 4], [2.032, 4], [2.034, 5], [10.025, 6], [10.045, 6], [10.06, 7],
  ]) {
    player.frame(time);
    assert.equal(player.calls.draws, draws, `at ${time}s`);
  }
});

test('live cap changes reset the grid and switching Off restores pixel comparisons', () => {
  const player = playback();
  player.configure(30);
  player.frame(0);
  player.configure(30, false);
  player.frame(0.01);
  assert.equal(player.calls.uploads, 1);
  player.configure(24);
  player.frame(0.02);
  player.frame(0.05);
  assert.deepEqual(player.calls, { uploads: 2, draws: 2, reads: 0 });
  player.configure(0);
  player.frame(0.051);
  assert.equal(player.calls.reads, 1);
  assert.equal(player.stats().skipped, 3);
  player.configure(24);
  player.frame(0.052);
  assert.equal(player.stats().drawn, 1);
  assert.equal(player.calls.reads, 1);
});
