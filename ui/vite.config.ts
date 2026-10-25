// Vite build for the UI; the dev server proxies /api to a local visvet.

import { defineConfig } from 'vite'

export default defineConfig({ server: { proxy: { '/api': 'http://127.0.0.1:7878' } } })
