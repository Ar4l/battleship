/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Inline the single CSS file into index.html to save a round trip. */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
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
  return {
    name: 'trim-trystero',
    load(id) {
      const m = /@trystero-p2p[\\/]core[\\/]dist[\\/](media|actions|action-wire)\.mjs$/.exec(id);
      return m ? readFileSync(dir + m[1] + '.mjs', 'utf8') : undefined;
    },
    transform(code, id) {
      if (!/@trystero-p2p[\\/]core[\\/]dist[\\/]handshake\.mjs$/.test(id)) return;
      // No room password is used, so the password challenge reduces to the user handshake.
      const out = code.replace(/const overlapRoomPasswordErr[^]*?(?=const toHandshakeErrorMessage)/, 'const createPasswordHandshake = () => ({ compose: (h) => h });\n');
      if (out === code) throw Error('trim-trystero: handshake.mjs changed; update build/trystero');
      return out;
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
