import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const app = (p) => here(`./app/${p}`);

// Fields only Pro may see. When Pro is configured, production builds leave them out of the public school data, so
// they reach the browser only through the server-side `sky` function.
const PRO_FIELDS = ['nbi', 'earn'];
function stripProFields(enabled) {
  return {
    name: 'strip-pro-fields',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!enabled || !id.endsWith('/src/data.json')) return null;
      const data = JSON.parse(code);
      for (const s of data.schools) for (const k of PRO_FIELDS) delete s[k];
      return { code: JSON.stringify(data), map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here('.'), 'VITE_');
  const proOn = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY && env.VITE_LEMON_CHECKOUT_URL);
  return {
    root: app(''),
    envDir: here('.'),
    plugins: [stripProFields(proOn)],
    build: {
      outDir: here('./dist'),
      emptyOutDir: true,
      rollupOptions: { input: { main: app('index.html'), about: app('about.html'), privacy: app('privacy.html') } },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      root: here('.'),
      include: ['tests/**/*.test.js'],
    },
  };
});
