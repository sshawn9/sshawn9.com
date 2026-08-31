import { describe, expect, it } from 'vitest';
import { formatUiCopy, getFoundationCopy } from '@sshawn9/site-i18n/copy';

describe('shared site copy', () => {
  it('renders both locales from the generated catalog without relying on ambient locale state', () => {
    const en = getFoundationCopy('en');
    const zh = getFoundationCopy('zh');

    expect(en.home).toBe('Home');
    expect(zh.home).toBe('首页');
    expect(en.switchLanguage).toBe('Switch to 中文');
    expect(zh.switchLanguage).toBe('切换到English');
    expect(formatUiCopy(en.articleVersionTitleTemplate, { title: 'Article', version: 2 })).toBe(
      'Article (v2)',
    );
    expect(formatUiCopy(zh.articleVersionTitleTemplate, { title: '文章', version: 2 })).toBe(
      '文章（v2）',
    );
  });
});
