import { describe, expect, it } from 'vitest';
import {
  resolveProjects,
  type ProjectMetadataEntry,
  type ResolvableProjectEntry,
} from '@sshawn9/site-domain/projects';

const project: ResolvableProjectEntry = {
  id: 'orphan/index',
  body: '',
  data: { title: 'orphan', description: 'orphan', tags: [] },
};
const metadata: ProjectMetadataEntry = { id: 'orphan', data: { order: 0 } };

describe('project owner validation', () => {
  it('rejects content and metadata without a matching owner', () => {
    expect(() => resolveProjects([project], [], 'en')).toThrow(
      'No project metadata found for “orphan”.',
    );
    expect(() => resolveProjects([], [metadata], 'en')).toThrow(
      'No localized project content found for “orphan”.',
    );
  });
});
