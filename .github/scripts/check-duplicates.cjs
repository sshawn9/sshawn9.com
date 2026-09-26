function findSuccessfulJob(jobs, expectedName) {
  return jobs.find(
    (job) =>
      job.name.split(' / ').slice(-2).join(' / ') === expectedName &&
      job.status === 'completed' &&
      job.conclusion === 'success',
  );
}

async function getRunTreeHash({ github, repo, run, execution, treesByCommit }) {
  if (run.event !== 'pull_request') return run.head_commit?.tree_id;

  // A PR run's head_commit describes its head branch, not the tested merge commit.
  if (!treesByCommit.has(execution.sha)) {
    const { data: commit } = await github.rest.git.getCommit({
      ...repo,
      commit_sha: execution.sha,
    });
    const treeHash = commit.tree.sha;
    if (!/^[0-9a-f]{40}$/.test(treeHash)) {
      throw new Error(`Invalid tree for PR workflow commit ${execution.sha}`);
    }
    treesByCommit.set(execution.sha, treeHash);
  }
  return treesByCommit.get(execution.sha);
}

async function findSuccessfulJobs({
  github,
  repo,
  repositoryId,
  treeHash,
  executionPath,
  expectedJobNames,
}) {
  const successfulJobs = new Map();
  const treesByCommit = new Map();
  const runs = github.paginate.iterator(github.rest.actions.listWorkflowRunsForRepo, {
    ...repo,
    per_page: 100,
  });
  for await (const { data } of runs) {
    for (const run of data) {
      if (String(run.head_repository?.id) !== String(repositoryId)) continue;
      const execution = run.referenced_workflows?.find((workflow) =>
        workflow.path.startsWith(executionPath),
      );
      if (!execution) continue;
      const runTreeHash = await getRunTreeHash({ github, repo, run, execution, treesByCommit });
      if (runTreeHash !== treeHash) continue;

      const jobs = github.paginate.iterator(github.rest.actions.listJobsForWorkflowRun, {
        ...repo,
        run_id: run.id,
        filter: 'all',
        per_page: 100,
      });
      for await (const { data } of jobs) {
        for (const name of expectedJobNames) {
          if (successfulJobs.has(name)) continue;
          const successful = findSuccessfulJob(data, name);
          if (successful) successfulJobs.set(name, successful);
        }
        if (successfulJobs.size === expectedJobNames.length) return successfulJobs;
      }
    }
  }
  return successfulJobs;
}

module.exports = async function checkDuplicates(
  { github, context, core },
  { tree_hash: treeHash, preview, production },
) {
  if (!/^[0-9a-f]{40}$/.test(treeHash)) {
    throw new Error(`Invalid repository tree hash: ${treeHash}`);
  }
  if (typeof preview !== 'boolean' || typeof production !== 'boolean') {
    throw new Error('Preview and Production selections must be booleans');
  }
  const requestedModes = [];
  if (preview) requestedModes.push('preview');
  if (production) requestedModes.push('production');
  if (requestedModes.length === 0) {
    throw new Error('Select at least one browser test mode');
  }

  const expectedJobNames = requestedModes.map(
    (mode) => `Checks (${mode}) / Checks and Tests (${mode})`,
  );
  const successfulJobs = await findSuccessfulJobs({
    github,
    repo: context.repo,
    repositoryId: context.payload.repository.id,
    treeHash,
    executionPath: `${context.repo.owner}/${context.repo.repo}/.github/workflows/checks-and-tests-execution.yml@`,
    expectedJobNames,
  });
  const modesToRun = requestedModes.filter((mode, index) => {
    const successful = successfulJobs.get(expectedJobNames[index]);
    if (successful) core.info(`Reusing successful ${mode} checks: ${successful.html_url}`);
    return !successful;
  });
  core.setOutput('modes_to_run', JSON.stringify(modesToRun));
  core.setOutput('mode_count', modesToRun.length);
};
