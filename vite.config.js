import { defineConfig } from 'vite';
import { copyFileSync } from 'fs';
import { resolve } from 'path';

// sw.js and icon.svg are referenced by a runtime string (service worker
// registration/precache list), not a static <script>/<link> tag Vite can see,
// so they need to be copied through unhashed manually.
function copyServiceWorkerAssets() {
    return {
        name: 'copy-sw-and-icon',
        closeBundle() {
            copyFileSync(resolve(__dirname, 'public/sw.js'), resolve(__dirname, 'dist/sw.js'));
            copyFileSync(resolve(__dirname, 'public/icon.svg'), resolve(__dirname, 'dist/icon.svg'));
        },
    };
}

export default defineConfig({
    root: 'public',
    plugins: [copyServiceWorkerAssets()],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
});
