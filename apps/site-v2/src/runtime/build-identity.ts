import { normalizeBuildId } from './build-generation';

/** One value is compiled into both the generated HTML and its client bundle. */
export const CURRENT_BUILD_ID =
  normalizeBuildId(import.meta.env.V2_BUILD_ID) ?? 'site-v2-development';
