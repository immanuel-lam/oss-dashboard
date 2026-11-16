import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';

// The dashboard UI builds into public/app and is served by the Worker. `npm run web:dev` proxies the API to `npm run dev`.
export default defineConfig({
 root:'web',
 base:'/app/',
 plugins:[react(),tailwindcss()],
 resolve:{alias:{'@':fileURLToPath(new URL('./web/src',import.meta.url))}},
 build:{outDir:'../public/app',emptyOutDir:true,assetsInlineLimit:0,sourcemap:false,chunkSizeWarningLimit:1200},
 server:{proxy:{'/api':'http://localhost:8787','/fonts':'http://localhost:8787'}},
});
