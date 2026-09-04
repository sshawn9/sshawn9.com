import { SITE_MODE } from 'astro:env/server';

export type DeploymentMode = 'preview' | 'production';

export type SiteContext = {
  developmentServer: boolean;
  deploymentMode: DeploymentMode;
  includeDraftArticles: boolean;
  noIndex: boolean;
};

export function createSiteContext(
  developmentServer: boolean,
  deploymentMode: DeploymentMode,
): SiteContext {
  return {
    developmentServer,
    deploymentMode,
    includeDraftArticles: developmentServer || deploymentMode === 'preview',
    noIndex: deploymentMode === 'preview',
  };
}

export const SITE_CONTEXT = createSiteContext(import.meta.env.DEV, SITE_MODE);
