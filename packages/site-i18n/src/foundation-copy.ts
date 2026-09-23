import type { Locale } from '@sshawn9/site-domain/locales';
import * as m from '../generated/messages.js';

export type FoundationCopy = {
  home: string;
  skipToContent: string;
  primaryNavigation: string;
  mobileNavigation: string;
  navProjects: string;
  navBlog: string;
  navAbout: string;
  navSearch: string;
  openNavigation: string;
  closeNavigation: string;
  githubProfile: string;
  searchPageTitle: string;
  searchPageDescription: string;
  searchPlaceholder: string;
  searchInputLabel: string;
  searchInputHint: string;
  searchClear: string;
  searchResultsLabel: string;
  searchSearchingTemplate: string;
  searchZeroResultsTemplate: string;
  searchOneResultTemplate: string;
  searchManyResultsTemplate: string;
  searchLoading: string;
  searchError: string;
  searchEmptyTitle: string;
  searchEmptyDescription: string;
  searchUnavailableTitle: string;
  searchUnavailableDescription: string;
  searchResultTypePage: string;
  searchResultTypeArticle: string;
  searchResultTypeProject: string;
  searchDevTitle: string;
  searchDevDescription: string;
  switchLanguage: string;
  themeToggle: string;
  themeToLight: string;
  themeToDark: string;
  wallpaperPhotoBy: string;
  wallpaperOn: string;
  wallpaperControls: string;
  wallpaperNext: string;
  wallpaperDownload: string;
  wallpaperUseRandom: string;
  wallpaperAutoRotation: string;
  homeHeroTitle: string;
  homeViewProjects: string;
  homeReadBlog: string;
  homeProjectsTitle: string;
  homeAllProjects: string;
  homeLatestArticles: string;
  homeAllArticles: string;
  aboutPageTitle: string;
  aboutUnderConstruction: string;
  projectsPageTitle: string;
  projectsPageDescription: string;
  projectTags: string;
  projectRelatedArticles: string;
  articleFirstPublished: string;
  articleLastUpdated: string;
  articleInformation: string;
  articleSupportingInformation: string;
  articleSidebarCollapse: string;
  articleSidebarExpand: string;
  articleSidebarResize: string;
  articleToc: string;
  articleBackToTop: string;
  articleVersionTitleTemplate: string;
  articleFallbackNoticeTemplate: string;
  articleFallbackLanguageEn: string;
  articleFallbackLanguageZh: string;
  versionHeading: string;
  versionFirstRelease: string;
  versionCompareHeading: string;
  versionChooseComparison: string;
  versionComparePageTitleTemplate: string;
  versionComparePageDescriptionTemplate: string;
  versionCompareEyebrow: string;
  versionDisplayMode: string;
  versionUnified: string;
  versionSplit: string;
  versionBaseLabelTemplate: string;
  versionChooseOther: string;
  diffRemoved: string;
  diffAdded: string;
  diffNoChanges: string;
  diffLoading: string;
  diffError: string;
  diffStaticFallback: string;
  breadcrumbs: string;
  blogPageTitle: string;
  blogPageDescription: string;
  articleTags: string;
  blogSidebarCollapse: string;
  blogSidebarExpand: string;
  blogSidebarResize: string;
  blogTagSelected: string;
  blogArticleCountTemplate: string;
  blogArticleRangeTemplate: string;
  blogPageCountTemplate: string;
  blogDisplayCompact: string;
  blogPageSize: string;
  blogPageSizeDisplayTemplate: string;
  blogEmpty: string;
  paginationLabel: string;
  paginationPrevious: string;
  paginationNext: string;
  paginationTargetPageTemplate: string;
  tagPageTitleTemplate: string;
  tagPageDescriptionTemplate: string;
};

export function getFoundationCopy(locale: Locale): FoundationCopy {
  const options: { locale?: Locale } = { locale };
  const staticMessage = (message: (inputs?: {}, options?: { locale?: Locale }) => string) =>
    message({}, options);

  return {
    home: staticMessage(m.home),
    skipToContent: staticMessage(m.skip_to_content),
    primaryNavigation: staticMessage(m.nav_main),
    mobileNavigation: staticMessage(m.nav_mobile),
    navProjects: staticMessage(m.nav_projects),
    navBlog: staticMessage(m.nav_blog),
    navAbout: staticMessage(m.nav_about),
    navSearch: staticMessage(m.nav_search),
    openNavigation: staticMessage(m.open_navigation),
    closeNavigation: staticMessage(m.close_navigation),
    githubProfile: staticMessage(m.github_profile),
    searchPageTitle: staticMessage(m.search_page_title),
    searchPageDescription: staticMessage(m.search_page_description),
    searchPlaceholder: staticMessage(m.search_placeholder),
    searchInputLabel: staticMessage(m.search_input_label),
    searchInputHint: staticMessage(m.search_input_hint),
    searchClear: staticMessage(m.search_clear),
    searchResultsLabel: staticMessage(m.search_results_label),
    searchSearchingTemplate: m.search_searching({ query: '{query}' }, options),
    searchZeroResultsTemplate: m.search_zero_results({ query: '{query}' }, options),
    searchOneResultTemplate: m.search_one_result({ query: '{query}' }, options),
    searchManyResultsTemplate: m.search_many_results(
      { query: '{query}', count: '{count}' },
      options,
    ),
    searchLoading: staticMessage(m.search_loading),
    searchError: staticMessage(m.search_error),
    searchEmptyTitle: staticMessage(m.search_empty_title),
    searchEmptyDescription: staticMessage(m.search_empty_description),
    searchUnavailableTitle: staticMessage(m.search_unavailable_title),
    searchUnavailableDescription: staticMessage(m.search_unavailable_description),
    searchResultTypePage: staticMessage(m.search_result_type_page),
    searchResultTypeArticle: staticMessage(m.search_result_type_article),
    searchResultTypeProject: staticMessage(m.search_result_type_project),
    searchDevTitle: staticMessage(m.search_dev_title),
    searchDevDescription: staticMessage(m.search_dev_description),
    switchLanguage: m.language_switch_to(
      {
        language:
          locale === 'en' ? staticMessage(m.language_chinese) : staticMessage(m.language_english),
      },
      options,
    ),
    themeToggle: staticMessage(m.theme_toggle),
    themeToLight: staticMessage(m.theme_to_light),
    themeToDark: staticMessage(m.theme_to_dark),
    wallpaperPhotoBy: staticMessage(m.wallpaper_photo_by),
    wallpaperOn: staticMessage(m.wallpaper_on),
    wallpaperControls: staticMessage(m.wallpaper_controls),
    wallpaperNext: staticMessage(m.wallpaper_next),
    wallpaperDownload: staticMessage(m.wallpaper_download),
    wallpaperUseRandom: staticMessage(m.wallpaper_use_random),
    wallpaperAutoRotation: staticMessage(m.wallpaper_auto_rotation),
    homeHeroTitle: staticMessage(m.home_hero_title),
    homeViewProjects: staticMessage(m.home_view_projects),
    homeReadBlog: staticMessage(m.home_read_blog),
    homeProjectsTitle: staticMessage(m.home_projects_title),
    homeAllProjects: staticMessage(m.home_all_projects),
    homeLatestArticles: staticMessage(m.home_latest_articles),
    homeAllArticles: staticMessage(m.home_all_articles),
    aboutPageTitle: staticMessage(m.about_page_title),
    aboutUnderConstruction: staticMessage(m.about_under_construction),
    projectsPageTitle: staticMessage(m.projects_page_title),
    projectsPageDescription: staticMessage(m.projects_page_description),
    projectTags: staticMessage(m.project_tags),
    projectRelatedArticles: staticMessage(m.project_related_articles),
    articleFirstPublished: staticMessage(m.article_first_published),
    articleLastUpdated: staticMessage(m.article_last_updated),
    articleInformation: staticMessage(m.article_information),
    articleSupportingInformation: staticMessage(m.article_supporting_information),
    articleSidebarCollapse: staticMessage(m.article_sidebar_collapse),
    articleSidebarExpand: staticMessage(m.article_sidebar_expand),
    articleSidebarResize: staticMessage(m.article_sidebar_resize),
    articleToc: staticMessage(m.article_toc),
    articleBackToTop: staticMessage(m.article_back_to_top),
    articleVersionTitleTemplate: m.article_version_title(
      { title: '{title}', version: '{version}' },
      options,
    ),
    articleFallbackNoticeTemplate: m.article_fallback_notice(
      { language: '{language}', requestedLanguage: '{requestedLanguage}' },
      options,
    ),
    articleFallbackLanguageEn: staticMessage(m.article_fallback_language_en),
    articleFallbackLanguageZh: staticMessage(m.article_fallback_language_zh),
    versionHeading: staticMessage(m.version_heading),
    versionFirstRelease: staticMessage(m.version_first_release),
    versionCompareHeading: staticMessage(m.version_compare_heading),
    versionChooseComparison: staticMessage(m.version_choose_comparison),
    versionComparePageTitleTemplate: m.version_compare_page_title({ title: '{title}' }, options),
    versionComparePageDescriptionTemplate: m.version_compare_page_description(
      { title: '{title}' },
      options,
    ),
    versionCompareEyebrow: staticMessage(m.version_compare_eyebrow),
    versionDisplayMode: staticMessage(m.version_display_mode),
    versionUnified: staticMessage(m.version_unified),
    versionSplit: staticMessage(m.version_split),
    versionBaseLabelTemplate: m.version_base_label({ version: '{version}' }, options),
    versionChooseOther: staticMessage(m.version_choose_other),
    diffRemoved: staticMessage(m.diff_removed),
    diffAdded: staticMessage(m.diff_added),
    diffNoChanges: staticMessage(m.diff_no_changes),
    diffLoading: staticMessage(m.diff_loading),
    diffError: staticMessage(m.diff_error),
    diffStaticFallback: staticMessage(m.diff_static_fallback),
    breadcrumbs: staticMessage(m.breadcrumbs),
    blogPageTitle: staticMessage(m.blog_page_title),
    blogPageDescription: staticMessage(m.blog_page_description),
    articleTags: staticMessage(m.article_tags),
    blogSidebarCollapse: staticMessage(m.blog_sidebar_collapse),
    blogSidebarExpand: staticMessage(m.blog_sidebar_expand),
    blogSidebarResize: staticMessage(m.blog_sidebar_resize),
    blogTagSelected: staticMessage(m.blog_tag_selected),
    blogArticleCountTemplate: m.blog_article_count({ count: '{count}' }, options),
    blogArticleRangeTemplate: m.blog_article_range({ range: '{range}', count: '{count}' }, options),
    blogPageCountTemplate: m.blog_page_count({ current: '{current}', total: '{total}' }, options),
    blogDisplayCompact: staticMessage(m.blog_display_compact),
    blogPageSize: staticMessage(m.blog_page_size),
    blogPageSizeDisplayTemplate: m.blog_page_size_display({ count: '{count}' }, options),
    blogEmpty: staticMessage(m.blog_empty),
    paginationLabel: staticMessage(m.pagination_label),
    paginationPrevious: staticMessage(m.pagination_previous),
    paginationNext: staticMessage(m.pagination_next),
    paginationTargetPageTemplate: m.pagination_target_page({ page: '{page}' }, options),
    tagPageTitleTemplate: m.tag_page_title({ tag: '{tag}' }, options),
    tagPageDescriptionTemplate: m.tag_page_description({ count: '{count}', tag: '{tag}' }, options),
  };
}

export function formatUiCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
