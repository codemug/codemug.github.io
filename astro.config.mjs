// @ts-check
import { defineConfig } from 'astro/config';
import { vertStaticDevRoutes } from './scripts/pc/vert/dev-plugin.mjs';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://usmanshahid.is-a.dev',

  vite: {
    plugins: [tailwindcss(), vertStaticDevRoutes()]
  },

  build: {
    inlineStylesheets: 'auto'
  },

  integrations: [mdx(), sitemap()]
});