/// <reference types="vitest/config" />
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

export default defineConfig({
  base: '/battleship/',
  build: {
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
  },
  plugins: [inlineCss()],
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
