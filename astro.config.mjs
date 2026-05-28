// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://codemug.github.io',

  vite: {
    plugins: [tailwindcss()]
  },

  build: {
    inlineStylesheets: 'auto'
  },

  integrations: [sitemap()]
});