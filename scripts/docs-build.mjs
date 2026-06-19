/**
 * docs-build: run the VitePress production build and FAIL on any doc-page
 * render error.
 *
 * VitePress SSR-renders every page at build time. A live `<script setup>`
 * demo (e.g. the `DAGDeriver.derive` / `new Dagonizer` examples) that THROWS
 * during render is caught by VitePress, logged, and the build continues with
 * exit 0 — so a broken doc demo ships silently. This wrapper captures the build
 * output and exits non-zero when a page's component throws, closing that gate.
 *
 * Detection: an uncaught error during page render surfaces as a stack trace
 * whose frames point into the compiled doc module under `.vitepress/.temp/…md.js`
 * (or a bare `…md.js:` frame). Those frames appear ONLY when a doc page's setup
 * throws — they are absent from a clean build — so they are a precise signal.
 */

import { spawn } from 'node:child_process';

const RENDER_ERROR = [
  /\.vitepress[/\\]\.temp[/\\][^\s]*\.md\.js/, // stack frame in a compiled doc page
  /\bat\b[^\n]*[/\\][^\s]*\.md\.js:\d+/, //       generic compiled-doc-page frame
  /\bDAGError\b/, //                              framework throw surfaced during render
];

const captured = [];

const child = spawn('npx', ['vitepress', 'build', 'docs'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: false,
});

const tee = (stream, sink) => {
  stream.on('data', (chunk) => {
    sink.write(chunk);
    captured.push(chunk.toString());
  });
};

tee(child.stdout, process.stdout);
tee(child.stderr, process.stderr);

child.on('close', (code) => {
  const output = captured.join('');
  const hit = RENDER_ERROR.find((re) => re.test(output));

  if (hit !== undefined) {
    process.stderr.write(
      `\ndocs-build: a doc page threw during render (matched ${hit}). `
      + 'The VitePress build masks this as exit 0; failing the build so a broken '
      + 'live demo cannot ship.\n',
    );
    process.exit(1);
  }

  process.exit(code ?? 0);
});
