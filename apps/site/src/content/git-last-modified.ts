import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

export type SourceLastModifiedResolver = (filePath: string | undefined) => Date | undefined;

/**
 * Creates a build-scoped Git timestamp resolver. Git is an input adapter here:
 * content/domain code receives a Date and never shells out or knows repository layout.
 */
export function createSourceLastModifiedResolver(
  sourcePathBase: string,
): SourceLastModifiedResolver {
  const cache = new Map<string, Date | undefined>();
  let completeHistoryChecked = false;
  let repositoryRoot: string | undefined;

  function getRepositoryRoot(): string {
    repositoryRoot ??= execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: sourcePathBase,
      encoding: 'utf8',
    }).trim();
    return repositoryRoot;
  }

  function assertCompleteHistory(root: string): void {
    if (completeHistoryChecked) return;

    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (shallow === 'true') {
      throw new Error(
        'Automatic article update dates require complete Git history. Fetch the repository with depth 0.',
      );
    }
    completeHistoryChecked = true;
  }

  return (filePath) => {
    if (!filePath) return undefined;
    const root = getRepositoryRoot();
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(sourcePathBase, filePath);
    const repositoryPath = relative(root, absolutePath);
    if (cache.has(repositoryPath)) return cache.get(repositoryPath);

    assertCompleteHistory(root);
    const timestamp = execFileSync('git', ['log', '-1', '--format=%cI', '--', repositoryPath], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const modifiedAt = timestamp ? new Date(timestamp) : undefined;
    if (modifiedAt && Number.isNaN(modifiedAt.getTime())) {
      throw new Error(`Git returned an invalid update date for ${repositoryPath}: ${timestamp}`);
    }

    cache.set(repositoryPath, modifiedAt);
    return modifiedAt;
  };
}
