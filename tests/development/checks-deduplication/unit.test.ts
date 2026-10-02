import { describe, expect, it, vi } from 'vitest';
import checkDuplicates from '../../../.github/scripts/check-duplicates.cjs';

const treeHash = 'a'.repeat(40);
const otherTreeHash = 'b'.repeat(40);
const mergeSha = 'c'.repeat(40);
const executionPath = `example/site/.github/workflows/checks-and-tests-execution.yml@${mergeSha}`;
const context = { repo: { owner: 'example', repo: 'site' }, payload: { repository: { id: 123 } } };

function workflowRun(id = 1) {
  return {
    id,
    event: 'push',
    head_repository: { id: 123 },
    head_commit: { tree_id: treeHash },
    referenced_workflows: [{ path: executionPath, sha: mergeSha }],
  };
}

function successfulJob(mode: string) {
  return {
    name: `checks-and-tests-reusable / Checks (${mode}) / Checks and Tests (${mode})`,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/example/site/actions/runs/1/job/${mode}`,
  };
}

type Run = ReturnType<typeof workflowRun>;
type Job = ReturnType<typeof successfulJob>;
type Pages<T> = (T[] | Error)[];

function fixture({
  runs = [[workflowRun()]],
  jobs = {},
  mergeTree = treeHash,
}: {
  runs?: Pages<Run>;
  jobs?: Record<number, Pages<Job>>;
  mergeTree?: string | Error;
} = {}) {
  const listWorkflowRunsForRepo = vi.fn();
  const listJobsForWorkflowRun = vi.fn();
  const getCommit = vi.fn(async () => {
    if (mergeTree instanceof Error) throw mergeTree;
    return { data: { tree: { sha: mergeTree } } };
  });
  const iterator = vi.fn(async function* (endpoint, options) {
    const pages = endpoint === listWorkflowRunsForRepo ? runs : (jobs[options.run_id] ?? [[]]);
    for (const page of pages) {
      if (page instanceof Error) throw page;
      yield { data: page };
    }
  });
  const github = {
    rest: { actions: { listWorkflowRunsForRepo, listJobsForWorkflowRun }, git: { getCommit } },
    paginate: { iterator },
  };
  const outputs: Record<string, unknown> = {};
  const core = {
    info: vi.fn(),
    setOutput: vi.fn((key: string, value: unknown) => {
      outputs[key] = value;
    }),
  };
  return {
    github,
    outputs,
    run: (inputs = { tree_hash: treeHash, preview: true, production: true }) =>
      checkDuplicates({ github, context, core }, inputs),
  };
}

function expectModes(outputs: Record<string, unknown>, modes: string[]) {
  expect(outputs).toEqual({ modes_to_run: JSON.stringify(modes), mode_count: modes.length });
}

describe('requested browser modes', () => {
  it.each([
    [true, false, ['preview']],
    [false, true, ['production']],
    [true, true, ['preview', 'production']],
  ])('selects preview=%s, production=%s without history', async (preview, production, modes) => {
    const test = fixture();
    await test.run({ tree_hash: treeHash, preview, production });
    expectModes(test.outputs, modes);
  });

  it('rejects an empty selection before querying history', async () => {
    const test = fixture();
    await expect(
      test.run({ tree_hash: treeHash, preview: false, production: false }),
    ).rejects.toThrow('Select at least one');
    expect(test.github.paginate.iterator).not.toHaveBeenCalled();
    expect(test.outputs).toEqual({});
  });

  it('rejects string booleans instead of treating a false string as selected', async () => {
    const test = fixture();
    await expect(
      test.run({ tree_hash: treeHash, preview: 'false' as unknown as boolean, production: true }),
    ).rejects.toThrow('must be booleans');
    expect(test.github.paginate.iterator).not.toHaveBeenCalled();
  });

  it('rejects an invalid tree hash before querying history', async () => {
    const test = fixture();
    await expect(
      test.run({ tree_hash: 'invalid', preview: true, production: true }),
    ).rejects.toThrow('Invalid repository tree hash');
    expect(test.github.paginate.iterator).not.toHaveBeenCalled();
  });
});

describe('successful validation reuse', () => {
  it.each([
    [[], ['preview', 'production']],
    [['preview'], ['production']],
    [['production'], ['preview']],
    [['preview', 'production'], []],
  ])('reuses successful modes %j', async (passed, remaining) => {
    const test = fixture({ jobs: { 1: [passed.map(successfulJob)] } });
    await test.run();
    expectModes(test.outputs, remaining);
    expect(test.github.paginate.iterator).toHaveBeenCalledTimes(2);
  });

  it('does not schedule an unrequested mode or reuse the other mode', async () => {
    const test = fixture({ jobs: { 1: [[successfulJob('production')]] } });
    await test.run({ tree_hash: treeHash, preview: true, production: false });
    expectModes(test.outputs, ['preview']);
  });

  it('collects both modes across runs and pages in one scan, then stops early', async () => {
    const test = fixture({
      runs: [[workflowRun()], [workflowRun(2)], new Error('Unnecessary history request')],
      jobs: {
        1: [[successfulJob('preview')]],
        2: [[], [successfulJob('production')], new Error('Unnecessary jobs request')],
      },
    });
    await test.run();
    expectModes(test.outputs, []);
    expect(test.github.paginate.iterator).toHaveBeenCalledTimes(3);
    expect(test.github.paginate.iterator).toHaveBeenCalledWith(
      test.github.rest.actions.listJobsForWorkflowRun,
      expect.objectContaining({ run_id: 2, filter: 'all' }),
    );
  });

  it.each([
    ['in_progress', 'success'],
    ['completed', 'failure'],
    ['completed', 'cancelled'],
    ['completed', 'skipped'],
  ])('does not reuse %s/%s', async (status, conclusion) => {
    const test = fixture({ jobs: { 1: [[{ ...successfulJob('preview'), status, conclusion }]] } });
    await test.run();
    expectModes(test.outputs, ['preview', 'production']);
  });

  it.each([
    'Checks (preview) / Browser Tests (preview)',
    'Checks (preview) / Checks and Unit Tests',
    'Unrelated / Checks and Tests (preview)',
    'Checks (production) / Checks and Tests (preview)',
  ])('does not reuse an incomplete or unrelated result: %s', async (name) => {
    const test = fixture({ jobs: { 1: [[{ ...successfulJob('preview'), name }]] } });
    await test.run();
    expectModes(test.outputs, ['preview', 'production']);
  });

  it.each([
    { ...workflowRun(), head_repository: { id: 999 } },
    { ...workflowRun(), head_commit: { tree_id: otherTreeHash } },
    { ...workflowRun(), referenced_workflows: [] },
    {
      ...workflowRun(),
      referenced_workflows: [
        { path: 'example/other/.github/workflows/checks-and-tests-execution.yml@x', sha: mergeSha },
      ],
    },
  ])('filters history from the wrong repository, tree or workflow', async (run) => {
    const test = fixture({ runs: [[run]], jobs: { 1: [[successfulJob('preview')]] } });
    await test.run();
    expectModes(test.outputs, ['preview', 'production']);
    expect(test.github.paginate.iterator).toHaveBeenCalledTimes(1);
  });
});

describe('PR merge trees and API failures', () => {
  it('reuses the tested merge tree and resolves a shared merge commit only once', async () => {
    const pr = { ...workflowRun(), event: 'pull_request', head_commit: { tree_id: otherTreeHash } };
    const test = fixture({
      runs: [[pr, { ...pr, id: 2 }]],
      jobs: { 1: [[successfulJob('preview')]], 2: [[successfulJob('production')]] },
    });
    await test.run();
    expectModes(test.outputs, []);
    expect(test.github.rest.git.getCommit).toHaveBeenCalledExactlyOnceWith({
      ...context.repo,
      commit_sha: mergeSha,
    });
  });

  it('does not mistake a matching PR head tree for the tested merge tree', async () => {
    const test = fixture({
      runs: [[{ ...workflowRun(), event: 'pull_request' }]],
      jobs: { 1: [[successfulJob('preview'), successfulJob('production')]] },
      mergeTree: otherTreeHash,
    });
    await test.run();
    expectModes(test.outputs, ['preview', 'production']);
    expect(test.github.paginate.iterator).toHaveBeenCalledTimes(1);
  });

  it.each([
    { runs: [new Error('History API failed')] },
    { jobs: { 1: [[successfulJob('preview')], new Error('Jobs API failed')] } },
    {
      runs: [[workflowRun()], new Error('Next page failed')],
      jobs: { 1: [[successfulJob('preview')]] },
    },
    {
      runs: [[{ ...workflowRun(), event: 'pull_request' }]],
      mergeTree: new Error('Commit API failed'),
    },
    { runs: [[{ ...workflowRun(), event: 'pull_request' }]], mergeTree: 'invalid' },
  ])('fails without publishing a partial scheduling decision', async (options) => {
    const test = fixture(options);
    await expect(test.run()).rejects.toThrow();
    expect(test.outputs).toEqual({});
  });
});
