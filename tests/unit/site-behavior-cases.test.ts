import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONTRACT_ROOT = fileURLToPath(new URL('../../docs/site-behavior-cases/', import.meta.url));

const EXPECTED_CASE_COUNTS = {
  'article-sidebar-toc-versions': 27,
  'blog-tags-sidebar': 29,
  'browser-cache-artifacts': 6,
  'content-tags-projects-media': 21,
  'development-preview-production': 21,
  'locale-theme-fonts': 15,
  'refresh-navigation-lifecycle': 14,
  'research-interactions': 20,
  'scenic-wallpaper': 19,
  search: 9,
  'site-structure-responsive-visual': 9,
  'validation-failure-classification': 8,
} as const;

const REQUIRED_CASE_HEADINGS = ['### 场景', '### 正确行为', '### 禁止状态', '### 验收'] as const;

const REQUIRED_PROPOSAL_SECTIONS = [
  '## 受影响案例',
  '## 当前行为',
  '## 建议行为',
  '## 用户可观察影响',
  '## 证据要求',
  '## 回滚',
] as const;

function readMarkdown(path: string) {
  return readFileSync(path, 'utf8');
}

function listCaseFiles(category: string) {
  return readdirSync(join(CONTRACT_ROOT, category), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name)
    .sort();
}

function readIndexedCaseFiles(category: string) {
  const readme = readMarkdown(join(CONTRACT_ROOT, category, 'README.md'));
  return [...readme.matchAll(/\]\(\.\/([^)]+\.md)\)/g)].map((match) => match[1]).sort();
}

function listProposalFiles() {
  return readdirSync(join(CONTRACT_ROOT, 'proposals'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

describe('site behavior contract documentation', () => {
  it('keeps all approved case categories and counts explicit', () => {
    const actualCounts = Object.fromEntries(
      Object.keys(EXPECTED_CASE_COUNTS).map((category) => [
        category,
        listCaseFiles(category).length,
      ]),
    );

    expect(actualCounts).toEqual(EXPECTED_CASE_COUNTS);
    expect(Object.values(actualCounts).reduce((total, count) => total + count, 0)).toBe(198);
  });

  it('keeps the root and category indexes synchronized with case files', () => {
    const rootReadme = readMarkdown(join(CONTRACT_ROOT, 'README.md'));

    for (const category of Object.keys(EXPECTED_CASE_COUNTS)) {
      expect(rootReadme).toContain(`](./${category}/)`);
      expect(readIndexedCaseFiles(category)).toEqual(listCaseFiles(category));
    }
  });

  it('keeps every case in the agreed human-readable structure', () => {
    for (const category of Object.keys(EXPECTED_CASE_COUNTS)) {
      for (const caseFile of listCaseFiles(category)) {
        const relativePath = `${category}/${caseFile}`;
        const document = readMarkdown(join(CONTRACT_ROOT, relativePath));

        expect(document, relativePath).toMatch(/^# 案例：.+/);

        const headingOffsets = REQUIRED_CASE_HEADINGS.map((heading) => document.indexOf(heading));
        expect(headingOffsets, relativePath).not.toContain(-1);
        expect(headingOffsets, relativePath).toEqual([...headingOffsets].sort((a, b) => a - b));

        for (const heading of REQUIRED_CASE_HEADINGS) {
          expect(document.match(new RegExp(`^${heading}$`, 'gm')), relativePath).toHaveLength(1);
        }
      }
    }
  });

  it('keeps behavior change proposals explicit and non-implicit', () => {
    for (const proposalFile of listProposalFiles()) {
      const relativePath = `proposals/${proposalFile}`;
      const document = readMarkdown(join(CONTRACT_ROOT, relativePath));

      expect(document, relativePath).toMatch(/^# BCP-\d{3}：.+/);
      expect(document, relativePath).toMatch(/^- 状态：(待讨论|已批准|已拒绝|已撤回)$/m);
      expect(document, relativePath).toMatch(/^- 当前是否改变契约：(是|否)$/m);
      expect(document, relativePath).toMatch(/^- 当前是否允许实现：(是|否)$/m);

      const headingOffsets = REQUIRED_PROPOSAL_SECTIONS.map((heading) => document.indexOf(heading));
      expect(headingOffsets, relativePath).not.toContain(-1);
      expect(headingOffsets, relativePath).toEqual([...headingOffsets].sort((a, b) => a - b));
    }
  });
});
