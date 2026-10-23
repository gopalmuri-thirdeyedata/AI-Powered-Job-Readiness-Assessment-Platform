// Test support: bundle real frontend modules (JSX included) with esbuild so node:test can import and run them.
// axios is replaced by a recording fake; import.meta.env is stubbed; react / lucide / framer-motion stay external.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'pw-test-bundles');

const fakeAxiosPlugin = {
    name: 'fake-axios',
    setup(b) {
        b.onResolve({ filter: /^axios$/ }, () => ({ path: path.join(here, 'fakeAxios.mjs') }));
    },
};

export async function loadModule(relativeEntry) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const entry = path.resolve(root, relativeEntry);
    const key = createHash('sha1').update(entry + fs.readFileSync(entry, 'utf8')).digest('hex').slice(0, 12);
    const outfile = path.join(cacheDir, `${path.basename(entry).replace(/\W/g, '_')}.${key}.mjs`);
    await build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        jsx: 'automatic',
        loader: { '.js': 'jsx' },
        external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'react-router-dom', 'lucide-react', 'framer-motion'],
        plugins: [fakeAxiosPlugin],
        define: {
            'import.meta.env.VITE_API_URL': '"http://api.test"',
            'import.meta.env.DEV': 'false',
            'import.meta.env': '{}',
        },
        logLevel: 'silent',
    });
    return import(pathToFileURL(outfile).href);
}
