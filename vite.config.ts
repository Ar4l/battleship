/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Inline the single CSS file into index.html to save a round trip, and drop whitespace between tags. */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        html = html.replace(/>\s+</g, '><').trim();
        for (const [name, chunk] of Object.entries(ctx.bundle)) {
          if (chunk.type !== 'asset' || !name.endsWith('.css')) continue;
          const re = new RegExp(`<link[^>]+href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
          if (!re.test(html)) continue;
          html = html.replace(re, () => `<style>${String(chunk.source).trim()}</style>`);
          delete ctx.bundle[name];
        }
        return html;
      },
    },
  };
}

/**
 * modulePreload is off and all CSS is inlined, so Vite's preload helper (about
 * 0.5 KB gzipped in the entry) would only ever call through. Use a pass-through.
 */
function noPreloadHelper(): Plugin {
  return {
    name: 'no-preload-helper',
    apply: 'build',
    enforce: 'pre',
    load: (id) => (id === '\0vite/preload-helper.js' ? 'export const __vitePreload = (f) => f();' : undefined),
  };
}

/** Swap unused parts of Trystero for the small versions in build/trystero (see its README). */
function trimTrystero(): Plugin {
  const dir = fileURLToPath(new URL('./build/trystero/', import.meta.url));
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./node_modules/@trystero-p2p/core/package.json', import.meta.url)), 'utf8'));
  if (pkg.version !== '0.26.0') throw Error(`trim-trystero: built for @trystero-p2p/core 0.26.0, found ${pkg.version}; update build/trystero`);
  /** In-place patches: [file, pattern, replacement]. The build fails if a pattern is not found. */
  const patches: [string, RegExp, string][] = [
    // No room password is used, so the password challenge reduces to the user handshake.
    ['handshake', /const overlapRoomPasswordErr[^]*?(?=const toHandshakeErrorMessage)/, 'const createPasswordHandshake = () => ({ compose: (h) => h });\n'],
    // Trystero drops a peer 5 s after 'disconnected'. Wait longer than our own 20 s
    // grace (transport.ts) so a phone that is briefly backgrounded keeps the game.
    ['peer', /const disconnectedCloseDelayMs = 5e3;/, 'const disconnectedCloseDelayMs = 25e3;'],
  ];
  const applied = new Set<string>();
  return {
    name: 'trim-trystero',
    load(id) {
      const m = /@trystero-p2p[\\/]core[\\/]dist[\\/](media|actions|action-wire)\.mjs$/.exec(id);
      return m ? readFileSync(dir + m[1] + '.mjs', 'utf8') : undefined;
    },
    transform(code, id) {
      const m = /@trystero-p2p[\\/]core[\\/]dist[\\/](\w+)\.mjs$/.exec(id);
      let out = code;
      for (const [file, re, to] of patches) {
        if (m?.[1] !== file) continue;
        const next = out.replace(re, to);
        if (next === out) throw Error(`trim-trystero: ${file}.mjs changed; update vite.config.ts`);
        out = next;
        applied.add(file);
      }
      return out === code ? undefined : out;
    },
    generateBundle() {
      for (const [file] of patches) if (!applied.has(file)) throw Error(`trim-trystero: ${file}.mjs was never patched`);
    },
  };
}

export default defineConfig({
  base: '/battleship/',
  build: {
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
  },
  plugins: [inlineCss(), trimTrystero(), noPreloadHelper()],
  // Serve Trystero unbundled in dev too, so the trims above apply and dev and production clients can meet.
  optimizeDeps: { exclude: ['@trystero-p2p/torrent', '@trystero-p2p/core'] },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
