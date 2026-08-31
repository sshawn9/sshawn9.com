import { describe, expect, it } from 'vitest';
import {
  resolveProjects,
  type ProjectMetadataEntry,
  type ResolvableProjectEntry,
} from '@sshawn9/site-domain/projects';

function project(id: string, body = ''): ResolvableProjectEntry {
  return {
    id,
    body,
    data: {
      title: id,
      description: `Description for ${id}`,
      tags: [id],
    },
  };
}

function metadata(
  id: string,
  order: number,
  preview?: ProjectMetadataEntry['data']['preview'],
): ProjectMetadataEntry {
  return { id, data: { order, preview } };
}

describe('project resolution', () => {
  it('prefers explicit localized content and reports whether a body exists', () => {
    const [resolved] = resolveProjects(
      [
        project('control/index', 'implicit English'),
        project('control/index.en', 'explicit English'),
        project('control/index.zh'),
      ],
      [metadata('control', 0, 'motion-control')],
      'en',
    );

    expect(resolved.entry.id).toBe('control/index.en');
    expect(resolved.contentLocale).toBe('en');
    expect(resolved.hasBody).toBe(true);
    expect(resolved.preview).toBe('motion-control');
  });

  it('falls back to the available language and keeps a stable metadata order', () => {
    const resolved = resolveProjects(
      [project('second/index.zh'), project('first/index.zh')],
      [metadata('second', 1), metadata('first', 0)],
      'en',
    );

    expect(resolved.map(({ id }) => id)).toEqual(['first', 'second']);
    expect(resolved.every(({ contentLocale }) => contentLocale === 'zh')).toBe(true);
    expect(resolved.every(({ hasBody }) => !hasBody)).toBe(true);
  });

  it('rejects content and metadata that do not have a matching owner', () => {
    expect(() => resolveProjects([project('orphan/index')], [], 'en')).toThrow(
      'No project metadata found for “orphan”.',
    );
    expect(() => resolveProjects([], [metadata('orphan', 0)], 'en')).toThrow(
      'No localized project content found for “orphan”.',
    );
  });
});
