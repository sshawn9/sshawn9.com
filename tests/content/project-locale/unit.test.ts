import { describe, expect, it } from 'vitest';
import {
  resolveProjects,
  type ProjectMetadataEntry,
  type ResolvableProjectEntry,
} from '@sshawn9/site-domain/projects';

function project(id: string, body = ''): ResolvableProjectEntry {
  return { id, body, data: { title: id, description: `Description for ${id}`, tags: [id] } };
}
function metadata(
  id: string,
  order: number,
  preview?: ProjectMetadataEntry['data']['preview'],
): ProjectMetadataEntry {
  return { id, data: { order, preview } };
}

describe('project locale resolution', () => {
  it('prefers explicit localized content and otherwise falls back in metadata order', () => {
    const [explicit] = resolveProjects(
      [
        project('control/index', 'implicit English'),
        project('control/index.en', 'explicit English'),
        project('control/index.zh'),
      ],
      [metadata('control', 0, 'motion-control')],
      'en',
    );
    expect(explicit.entry.id).toBe('control/index.en');
    expect(explicit.contentLocale).toBe('en');
    expect(explicit.hasBody).toBe(true);
    expect(explicit.preview).toBe('motion-control');

    const fallback = resolveProjects(
      [project('second/index.zh'), project('first/index.zh')],
      [metadata('second', 1), metadata('first', 0)],
      'en',
    );
    expect(fallback.map(({ id }) => id)).toEqual(['first', 'second']);
    expect(fallback.every(({ contentLocale }) => contentLocale === 'zh')).toBe(true);
    expect(fallback.every(({ hasBody }) => !hasBody)).toBe(true);
  });
});
