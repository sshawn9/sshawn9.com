import { defineConfig } from 'astro/config';
import { createSiteConfig } from './config/create-site-config.mjs';

export default defineConfig(createSiteConfig());
