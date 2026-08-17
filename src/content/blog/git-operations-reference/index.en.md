---
title: Git Operations Reference
description: A practical Git operations quick reference for real-world scenarios, helping you quickly find useful but hard-to-remember commands, and clarifying their usage conditions and execution impacts.
---

## Basic Notations and Terminology

### Notations in Command Formats

| Notation | Meaning |
| --- | --- |
| `<name>` | Placeholder to be replaced with the actual value; angle brackets themselves are not entered |
| `[<name>]` | Optional placeholder; square brackets themselves are not entered |
| `<name>...` | One or more values of the same kind can be provided; ellipsis itself is not entered |
| `A \| B` | Choose one from `A` and `B`; the vertical bar itself is not entered |

### `-ish`

The English suffix `-ish` means "somewhat like" or "having the characteristics of". Git documentation uses it to name a category of expressions that can be resolved to a specific object; it's not a command parameter to be entered verbatim.

`commit-ish` means a name or expression that can ultimately be resolved to a commit, such as:

```text
main          # Branch
v1.0.0        # Tag pointing to a commit
a1b2c3d       # commit ID
HEAD          # Current commit
HEAD~2        # The second-generation ancestor of the current commit
origin/main   # Remote-tracking branch
```

Therefore, `[<commit-ish>]` means you can fill in a branch, tag, commit ID, or `HEAD` expression here, or it can be omitted.

`tree-ish` means a name or expression that can ultimately be resolved to a tree object. Branches, commits, and tags pointing to commits can all be further resolved to the project file tree of that commit, so `main`, `v1.0.0`, `HEAD`, tree object IDs, and `HEAD^{tree}` can all serve as `tree-ish`.

### `HEAD`

`HEAD` is a special reference: under normal conditions, it points to the current branch; in a detached HEAD state, it points directly to a commit.

When the current branch is `main`, modifying files from a clean state, staging modifications, and creating commits will not change the `HEAD → main` reference relationship:

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 1040 150" role="img" aria-label="Horizontal workflow when HEAD points to main" aria-describedby="head-workflow-description" style="display: block; width: 100%; height: auto; margin: 1.5rem 0; color: var(--ink)">
  <desc id="head-workflow-description">The four states from left to right are clean, modifications in working directory, modifications staged, and commit created. Each state explicitly shows HEAD pointing to main; the operations between states are modifying README.md, git add README.md, and git commit.</desc>
  <defs>
    <marker id="head-state-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
    <marker id="head-reference-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--muted)" />
    </marker>
  </defs>
  <rect x="1" y="1" width="1038" height="148" rx="16" fill="var(--surface-strong)" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="650" text-anchor="middle">
    <text x="90" y="73">clean</text>
    <text x="370" y="73">Working Directory Modified</text>
    <text x="650" y="73">Modifications Staged</text>
    <text x="930" y="73">Commit Created</text>
  </g>
  <g stroke="var(--line)">
    <line x1="90" y1="88" x2="90" y2="100" />
    <line x1="370" y1="88" x2="370" y2="100" />
    <line x1="650" y1="88" x2="650" y2="100" />
    <line x1="930" y1="88" x2="930" y2="100" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="700" text-anchor="middle">
    <text x="52" y="125">HEAD</text>
    <text x="128" y="125">main</text>
    <text x="332" y="125">HEAD</text>
    <text x="408" y="125">main</text>
    <text x="612" y="125">HEAD</text>
    <text x="688" y="125">main</text>
    <text x="892" y="125">HEAD</text>
    <text x="968" y="125">main</text>
  </g>
  <g fill="none" stroke="var(--muted)" stroke-width="1.5" marker-end="url(#head-reference-arrow)">
    <line x1="72" y1="119" x2="105" y2="119" />
    <line x1="352" y1="119" x2="385" y2="119" />
    <line x1="632" y1="119" x2="665" y2="119" />
    <line x1="912" y1="119" x2="945" y2="119" />
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#head-state-arrow)">
    <line x1="130" y1="67" x2="295" y2="67" />
    <line x1="445" y1="67" x2="590" y2="67" />
    <line x1="710" y1="67" x2="870" y2="67" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="600" text-anchor="middle">
    <text x="212" y="32">modify README.md</text>
    <text x="518" y="32">git add README.md</text>
    <text x="790" y="32">git commit</text>
  </g>
</svg>

If you directly switch to a certain commit ID, `HEAD` will no longer point to a branch, but directly to that commit. This is called **detached HEAD**, meaning `HEAD` is detached from branches:

```text
HEAD → <commit-id>
```

You can still modify, stage, and commit under a detached HEAD state, but creating a commit will not move any local branch forward. To retain these commits, you should execute `git switch -c <new-branch>` to create a branch before leaving.

When executing an ordinary `git commit`, the new commit records the commit where the current branch was previously located; this commit immediately preceding the new commit is called its **parent commit**. The root commit at the beginning of history has no parent; an ordinary commit usually has one parent; and a commit resulting from merging multiple histories can have multiple parents. Both `^` and `~` leverage this relationship to navigate backward through commits.

Both start from a given commit, but their lookup rules differ:

- `<commit-ish>^<n>`: Selects the `n`-th parent of `<commit-ish>`, where `n` starts from `1`; when `<n>` is omitted, it selects the first parent.
- `<commit-ish>~<n>`: Starting from `<commit-ish>`, consecutively selects the first parent `n` times; when `<n>` is omitted, it only selects once.

Therefore, `^2` means "the second parent commit," while `~2` means "trace back two generations along the first parent chain"; `<commit-ish>^`, `<commit-ish>^1`, `<commit-ish>~`, and `<commit-ish>~1` all represent the same commit.

For example, `feature` branches off from `C1` on `main`. After executing `git merge feature` on `main`, a merge commit `M` is produced:

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 760 300" role="img" aria-label="Merge commit and its parent commits" aria-describedby="git-parent-graph-description" style="display: block; width: 100%; height: auto; margin: 2rem 0; color: var(--ink)">
  <desc id="git-parent-graph-description">feature branches off from the C1 commit on main; main and feature advance to C2 and F2 respectively, then merge into M. HEAD, HEAD^, HEAD^2, and HEAD~2 are respectively marked around the corresponding commits.</desc>
  <defs>
    <marker id="git-history-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
  </defs>
  <rect x="1" y="1" width="758" height="298" rx="18" fill="var(--surface-strong)" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-mono)" font-size="16">
    <text x="30" y="38">Execution Location: main</text>
    <text x="30" y="64">Command Executed: git merge feature</text>
    <g fill="var(--muted)">
      <text x="30" y="140">feature</text>
      <text x="30" y="220">main</text>
    </g>
    <g font-weight="700" text-anchor="middle">
      <text x="175" y="220">C0</text>
      <text x="340" y="220">C1</text>
      <text x="505" y="220">C2</text>
      <text x="670" y="220">M</text>
      <text x="340" y="140">F1</text>
      <text x="670" y="140">F2</text>
    </g>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#git-history-arrow)">
    <line x1="197" y1="214" x2="316" y2="214" />
    <line x1="362" y1="214" x2="481" y2="214" />
    <line x1="527" y1="214" x2="649" y2="214" />
    <line x1="362" y1="134" x2="648" y2="134" />
    <line x1="340" y1="196" x2="340" y2="154" />
    <line x1="670" y1="154" x2="670" y2="196" />
  </g>
  <g font-family="var(--font-mono)" font-size="14" text-anchor="middle">
    <g transform="translate(670 96)">
      <rect x="-46" y="-16" width="92" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD^2</text>
    </g>
    <g transform="translate(340 264)">
      <rect x="-46" y="-16" width="92" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD~2</text>
    </g>
    <g transform="translate(505 264)">
      <rect x="-40" y="-16" width="80" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD^</text>
    </g>
    <g transform="translate(670 264)">
      <rect x="-36" y="-16" width="72" height="30" rx="8" fill="var(--page-muted)" stroke="var(--line)" />
      <text y="4" fill="currentColor">HEAD</text>
    </g>
  </g>
</svg>

Each directed line in the figure points from a parent commit to the subsequent commit it produced.

First and second are not inferred based on positions or branch names in the figure, but rather on the order of multiple `parent` records within the merge commit object. When `git merge feature` is executed on `main`:

1. Before the merge, `HEAD` points to `main`, and `main` points to `C2`; Git writes `C2` into the first `parent` record.
2. `feature` points to `F2`; during the merge, Git uses `MERGE_HEAD` to record this incoming commit, and writes `F2` into the second `parent` record.

Therefore, the relevant content of the merge commit `M` is equivalent to:

```text
parent <commit ID of C2>
parent <commit ID of F2>
```

The two directed lines in the figure pointing from `C2` and `F2` to `M` correspond to these two records. The `HEAD^`, `HEAD^2`, and `HEAD~2` in the figure all assume that you remain on `main` after the merge is complete, at which point `HEAD` points to the merge commit `M`. Applying the aforementioned rules to `HEAD` at this time:

- `HEAD^`: Takes the first parent of `M`, yielding `C2`;
- `HEAD^2`: The number `2` means taking the second parent of `M`, yielding `F2`, not tracing back two generations;
- `HEAD~2`: Takes the first parent consecutively twice, going through `M → C2 → C1`, yielding `C1`.

These notations start searching from the commit `HEAD` points to at the time they are used, and do not fixedly represent a certain commit in the figure. If you subsequently switch to `feature`, `HEAD` will point to `F2`, and at that point `HEAD^` would represent `F2`'s first parent `F1`; the parent commit relationships of the merge commit `M` have not changed, it's just no longer accessed using `HEAD` as the starting point.

If you instead executed `git merge main` on `feature`, `HEAD` before the merge would be `F2`, so the first record would be `F2`, and the second record would be the incoming `C2`.

Merge commits are not limited to just two parents. When merging multiple branches into `main` simultaneously, for example:

```bash
git merge feature-a feature-b
```

If this command successfully generates a multi-branch merge commit, its commit object can contain three `parent` records:

```text
parent <commit ID where main was before merge>
parent <commit ID of feature-a>
parent <commit ID of feature-b>
```

This type of merge is called an **Octopus merge**. In this case, `HEAD^3` reads the third `parent` record; it differs from `HEAD~3`, which would trace back three generations consecutively along the first `parent` record. Commits can record any number of parents, and the specific order can be viewed directly in the commit object:

```bash
git cat-file -p HEAD
```

### Working Tree Status

The **working tree** (also often called the working directory) is the actual project files available for editing in the directory corresponding to the repository. Modifying files directly changes the working tree; newly created files that have not yet been tracked by Git will show up here as untracked files.

The **index** (also known as the staging area) stores the file snapshot information that will be used for the next commit; it is not a directory for people to edit directly. `git add` writes the current content of the specified files into the index, and `git commit` then creates a new commit based on the index.

The `HEAD` introduced earlier provides the file snapshot of the current commit. Based on the official Git [`git-status`](https://git-scm.com/docs/git-status) documentation, common statuses can be categorized into the following groups:

| Common Status | Working Tree | Index | `git status` Official Category |
| --- | --- | --- | --- |
| `clean` | Matches index for tracked files; no untracked files (except ignored ones) | Matches `HEAD` | `working tree clean` |
| Staged modifications | May match index, or might be modified again after staging | Saves modifications to be included in next commit, differs from `HEAD` | `Changes to be committed` |
| Unstaged modifications | Tracked files contain modifications not yet written to index | Hasn't saved latest working tree content, may also save earlier staged content | `Changes not staged for commit` |
| Untracked files | New paths not yet tracked by Git exist | No record of the path | `Untracked files` |
| Unmerged paths | Conflict resolution not yet complete | May hold multiple pending versions of the same path | `Unmerged paths` |

Except for `clean`, other statuses can appear simultaneously. For example, if a file is modified again after being staged, it will have both staged modifications and unstaged modifications simultaneously.

## switch: Switch Branches

`git switch <target-branch>` attempts to make the current worktree use the target branch. The process for handling existing local states during the switch is as follows:

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 1040 295" role="img" aria-label="Process of git switch handling local state" aria-describedby="git-switch-description" style="display: block; width: 100%; height: auto; margin: 1.5rem 0; color: var(--ink)">
  <desc id="git-switch-description">The current worktree switches from branch-a to branch-b. If staged modifications, unstaged modifications, and ordinary untracked files can be safely preserved, the switch succeeds, HEAD changes to point to branch-b, local states are preserved, and compared anew relative to branch-b; otherwise, the switch is aborted, and HEAD, index, and working directory remain unchanged.</desc>
  <defs>
    <marker id="switch-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
  </defs>
  <rect x="1" y="1" width="1038" height="293" rx="18" fill="var(--surface-strong)" stroke="var(--line)" />
  <text x="24" y="31" fill="var(--muted)" font-family="var(--font-sans)" font-size="14">Local State: Staged modifications, unstaged modifications, and untracked files</text>

  <rect x="24" y="78" width="190" height="140" rx="14" fill="none" stroke="var(--line)" />
  <text x="119" y="108" fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="700" text-anchor="middle">Before Switch</text>
  <line x1="48" y1="121" x2="190" y2="121" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14">
    <text x="48" y="148">HEAD → branch-a</text>
    <text x="48" y="174">Index: Local state</text>
    <text x="48" y="200">Working Tree: Local state</text>
  </g>

  <path d="M 520 73 L 642 148 L 520 223 L 398 148 Z" fill="none" stroke="var(--line)" />
  <g fill="currentColor" font-family="var(--font-sans)" font-size="16" font-weight="700" text-anchor="middle">
    <text x="520" y="143">Can local state</text>
    <text x="520" y="168">be safely preserved?</text>
  </g>

  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#switch-flow-arrow)">
    <line x1="214" y1="148" x2="386" y2="148" />
    <line x1="622" y1="110" x2="714" y2="83" />
    <line x1="622" y1="186" x2="714" y2="213" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="600" text-anchor="middle">
    <text x="300" y="132">git switch branch-b</text>
    <text x="670" y="79">Yes</text>
    <text x="670" y="218">No</text>
  </g>

  <rect x="726" y="36" width="290" height="105" rx="14" fill="none" stroke="var(--line)" />
  <text x="871" y="64" fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="700" text-anchor="middle">Switch Succeeds</text>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="13.5">
    <text x="750" y="88">HEAD → branch-b</text>
    <text x="750" y="111">Local State: Preserved</text>
    <text x="750" y="132">git status: Compared vs branch-b</text>
  </g>

  <rect x="726" y="158" width="290" height="105" rx="14" fill="none" stroke="var(--line)" />
  <text x="871" y="186" fill="currentColor" font-family="var(--font-sans)" font-size="17" font-weight="700" text-anchor="middle">Switch Aborted</text>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="13.5">
    <text x="750" y="210">HEAD → branch-a</text>
    <text x="750" y="233">Index, Worktree: Unchanged</text>
    <text x="750" y="254">Git reports blocking paths</text>
  </g>
</svg>

## restore: Unstage

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `-S`, `--staged` | Sets the restoration target to the index |

```bash
# Purpose: Unstage modifications for specified paths
# Result: Restores the corresponding content in the index to HEAD's version, keeping the working directory files unchanged
git restore --staged <pathspec>...
# Example 1: Unstage README.md, but keep the file modifications
git restore --staged README.md
```

## rebase: Replay Commits on a New Base

`rebase` transplants a commit sequence onto a new base. When executing `git rebase <upstream>`, Git finds the commits in the current branch that are not in `<upstream>`, recreating these commits sequentially after `<upstream>`, and finally points the current branch to the rebuilt sequence; `<upstream>` itself does not move.

<!-- prettier-ignore -->
<svg class="not-prose" viewBox="0 0 1040 330" role="img" aria-label="Commit history before and after rebasing feature/example to main" aria-describedby="rebase-graph-description" style="display: block; width: 100%; height: auto; margin: 1.5rem 0; color: var(--ink)">
  <desc id="rebase-graph-description">Before rebasing, feature/example branched off from commit B on main and contains C, D; main has advanced to E. After executing git rebase main, main still points to E, the modifications of feature/example are recreated as C′, D′ after E, and HEAD still points to feature/example.</desc>
  <defs>
    <marker id="rebase-history-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
    </marker>
  </defs>
  <rect x="1" y="1" width="1038" height="328" rx="18" fill="var(--surface-strong)" stroke="var(--line)" />
  <line x1="30" y1="165" x2="1010" y2="165" stroke="var(--line)" />
  <g font-family="var(--font-sans)" font-size="18" font-weight="700" fill="currentColor">
    <text x="32" y="40">Before Rebase</text>
    <text x="32" y="208">After Rebase</text>
  </g>
  <g transform="translate(425 147)">
    <rect width="190" height="36" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
    <text x="95" y="24" text-anchor="middle" fill="currentColor" font-family="var(--font-mono)" font-size="15" font-weight="700">git rebase main</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.75" marker-end="url(#rebase-history-arrow)">
    <line x1="157" y1="118" x2="263" y2="118" />
    <line x1="297" y1="118" x2="403" y2="118" />
    <line x1="295" y1="108" x2="404" y2="74" />
    <line x1="437" y1="68" x2="543" y2="68" />
    <line x1="157" y1="270" x2="263" y2="270" />
    <line x1="297" y1="270" x2="403" y2="270" />
    <line x1="437" y1="270" x2="543" y2="270" />
    <line x1="577" y1="270" x2="683" y2="270" />
  </g>
  <g fill="var(--page-muted)" stroke="currentColor" stroke-width="1.75">
    <circle cx="140" cy="118" r="16" />
    <circle cx="280" cy="118" r="16" />
    <circle cx="420" cy="118" r="16" />
    <circle cx="420" cy="68" r="16" />
    <circle cx="560" cy="68" r="16" />
    <circle cx="140" cy="270" r="16" />
    <circle cx="280" cy="270" r="16" />
    <circle cx="420" cy="270" r="16" />
    <circle cx="560" cy="270" r="16" />
    <circle cx="700" cy="270" r="16" />
  </g>
  <g fill="currentColor" font-family="var(--font-mono)" font-size="14" font-weight="700" text-anchor="middle">
    <text x="140" y="123">A</text>
    <text x="280" y="123">B</text>
    <text x="420" y="123">E</text>
    <text x="420" y="73">C</text>
    <text x="560" y="73">D</text>
    <text x="140" y="275">A</text>
    <text x="280" y="275">B</text>
    <text x="420" y="275">E</text>
    <text x="560" y="275">C′</text>
    <text x="700" y="275">D′</text>
  </g>
  <g font-family="var(--font-mono)" font-size="14" font-weight="650" fill="currentColor">
    <g transform="translate(454 98)">
      <rect width="82" height="40" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="41" y="25" text-anchor="middle">main</text>
    </g>
    <g transform="translate(594 48)">
      <rect width="228" height="40" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="114" y="25" text-anchor="middle">feature/example · HEAD</text>
    </g>
    <g transform="translate(379 214)">
      <rect width="82" height="36" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="41" y="23" text-anchor="middle">main</text>
    </g>
    <line x1="420" y1="250" x2="420" y2="253" stroke="var(--line)" />
    <g transform="translate(734 250)">
      <rect width="228" height="40" rx="10" fill="var(--page-muted)" stroke="var(--line)" />
      <text x="114" y="25" text-anchor="middle">feature/example · HEAD</text>
    </g>
  </g>
</svg>

`C'` and `D'` are newly created commits based on the modifications of `C` and `D`. Because their parent commits have changed, they have new commit IDs. Rebasing is suitable for tidying up local history that has not yet been shared; if other branches or users are already working based on these commits, you should coordinate before rewriting them.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `--onto <new-base>` | Changes the starting point of the rebuilt commits to `<new-base>` |
| `-i`, `--interactive` | Edit commit order and handling methods before rebuilding |
| `--autostash` | Temporarily saves local modifications before rebasing, then reapplies them afterward |
| `-r`, `--rebase-merges` | Attempts to recreate original merge structure on the new base |
| `--continue` | Continues the rebase after resolving conflicts or finishing edits |
| `--skip` | Skips the commit currently being applied |
| `--abort` | Aborts the rebase and restores the branch, index, and tracked working directory content to before the start |

```bash
# Purpose: Reapply commits unique to the current branch onto a new base
# Conditions: The current branch is the one to be rewritten; index and tracked files have no uncommitted modifications; related commits have not been shared or rewrite has been coordinated
# Result: Rebuilds current branch's commits after <upstream>, and points current branch to the new commit sequence; <upstream> remains unchanged
git rebase <upstream>
# Example 1: Current branch is feature/example, reapply its unique commits after main
git rebase main

# Purpose: Separately specify new base, commit selection boundary, and branch to rewrite
# Conditions: Index and tracked files have no uncommitted modifications; <branch> is not used by other worktrees; related commits have not been shared or rewrite coordinated
# Result: Selects commits unique to <branch> relative to <upstream>, reapplies them onto <new-base>, then points <branch> to the new sequence
git rebase --onto <new-base> <upstream> <branch>
# Example 1: Reapply commits from topic/example unique relative to integration onto main
git rebase --onto main integration topic/example

# Purpose: Adjust commit order, modify commit messages, squash or drop commits
# Conditions: Index and tracked files have no uncommitted modifications; pending commits not yet shared or rewrite coordinated
# Result: Opens a to-do list of commits arranged from oldest to newest, and recreates commits after <upstream> according to the saved content
git rebase -i <upstream>
# Example 1: Interactively tidy up the last 5 commits of the current branch
git rebase -i HEAD~5

# Purpose: Perform rebase when local modifications exist
# Conditions: No unresolved merge conflicts exist; ordinary untracked files must not block Git writes; related commits not shared or rewrite coordinated
# Result: Creates a temporary stash before rebasing, reapplies it after rebasing finishes; reapplying may still produce conflicts
git rebase --autostash <upstream>
# Example 1: Temporarily save local modifications, rebase current branch to main, then reapply these modifications
git rebase --autostash main

# Purpose: Recreate original merge structure during rebase
# Conditions: Index and tracked files have no uncommitted modifications; related commits not shared or rewrite coordinated
# Result: Reapplies ordinary commits on new base and attempts to recreate merge commits; previous manual conflict resolutions may need to be handled again
git rebase --rebase-merges <upstream>
# Example 1: Rebase current branch to main, and recreate its merge structure
git rebase --rebase-merges main

# Purpose: Continue rebase after resolving conflicts or finishing interactive edits
# Conditions: Rebase is paused; conflicts are resolved and staged with git add, or current editing is complete
# Result: Completes the rebuilding of the current commit and continues processing remaining commits
git rebase --continue

# Purpose: Skip currently un-applicable commit and continue rebase
# Conditions: Rebase is paused, and it is confirmed the new history doesn't need the current commit's modifications
# Result: The current commit will not enter the rebuilt history, rebase continues processing subsequent commits
git rebase --skip

# Purpose: Cancel a paused rebase
# Conditions: Rebase has started but not yet finished
# Result: Abandons the unfinished rebase, and restores to the state before the rebase started
git rebase --abort
```

## stash: Temporarily Save Modifications

`stash` records modifications in the current working directory and index into a local stash, returning the corresponding files to the `HEAD` state. `stash@{0}` denotes the newest record, and subsequent records are `stash@{1}`, `stash@{2}`, etc. By default, stashes are only saved in the current repository and won't be sent to remote repositories by a regular `push`.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `-m <message>`, `--message <message>` | Use `<message>` as the stash description |
| `-u`, `--include-untracked` | Save untracked files as well, but exclude ignored files |
| `-p`, `--patch` | When used with `push`, interactively choose modifications to save |
| `-p`, `--patch` | When used with `show`, show the full patch |
| `--stat` | Show diff statistics |
| `--` | End option parsing |

```bash
# Purpose: View the list of stashes in the current repository
git stash list

# Purpose: Temporarily save modifications to tracked files
# Conditions: Index must not contain unresolved merge conflicts
# Result: Creates a stash, saving staged and unstaged modifications, and returns corresponding files to HEAD state
git stash push -m <message>
# Example 1: Save current modifications to tracked files, and label the record as wip: example
git stash push -m "wip: example"

# Purpose: Save modifications to tracked files and untracked files simultaneously
# Conditions: Index must not contain unresolved merge conflicts
# Result: Creates a stash, saving staged, unstaged modifications, and untracked files; then returns tracked files to HEAD, and removes saved untracked files from working tree; ignored files remain unchanged
git stash push -u -m <message>
# Example 1: Save current modifications and untracked files, but not ignored files
git stash push -u -m "wip: example"

# Purpose: Only save modifications in specified paths
# Conditions: Index must not contain unresolved merge conflicts
# Result: Only writes modifications matching paths to stash and reverts them, other paths remain unchanged
git stash push -m <message> -- <pathspec>...
# Example 1: Only save modifications in docs/ and README.md
git stash push -m "wip: docs" -- docs/ README.md

# Purpose: View diff statistics for a specific stash
# Result: Shows diff stats of the stash relative to its base commit when created, changes no states
git stash show --stat <stash>
# Example 1: View diff stats of the newest stash
git stash show --stat stash@{0}

# Purpose: View full patch of a specific stash
# Result: Shows the full diff of the stash relative to its base commit when created, changes no states
git stash show -p <stash>
# Example 1: View full patch of the newest stash
git stash show -p stash@{0}

# Purpose: Apply a specific stash, while keeping the record
# Conditions: Working directory must match index
# Result: Applies recorded modifications to current state; may produce conflicts, but won't delete the stash
git stash apply <stash>
# Example 1: Apply newest stash, keeping the record
git stash apply stash@{0}

# Purpose: Apply a specific stash, and delete the record upon success
# Conditions: Working directory must match index
# Result: Applies recorded modifications to current state; deletes stash on success, keeps it on conflict
git stash pop <stash>
# Example 1: Apply newest stash, and delete the record upon success
git stash pop stash@{0}

# Purpose: Create a branch from the base commit when the stash was created and apply modifications
# Conditions: <new-branch> must not exist, current local modifications must not prevent switching to the stash's base commit
# Result: Creates and switches to new branch, applies stash; deletes stash record upon success
git stash branch <new-branch> <stash>
# Example 1: Create recovery/example branch and apply newest stash
git stash branch recovery/example stash@{0}
```

## worktree: Manage Multiple Working Trees

`worktree` allows the same repository to have multiple working directories simultaneously, using different branches or commits in each. The state of each worktree is mutually independent, but they share repository data, so there's no need to repeatedly clone the repository to work on multiple branches at once. The **main worktree** is the default repository directory created when cloning or initializing; `git worktree add` can create more worktrees outside of it.

```text
Main worktree/
├── Working directory files
└── .git/ ($GIT_COMMON_DIR)
    ├── objects/ (shared by all worktrees)
    ├── refs/heads/ (shared by all worktrees)
    ├── refs/tags/ (shared by all worktrees)
    ├── config (shared by default)
    ├── HEAD → main (independent to main worktree)
    ├── index (independent to main worktree)
    └── worktrees/ (subdir name usually takes terminal dir name of worktree, appending numbers on collision; not a commit ID)
        ├── <id-a>/ (corresponds to worktree A)
        │   ├── HEAD → branch-a
        │   └── index
        └── <id-b>/ (corresponds to worktree B)
            ├── HEAD → branch-b
            └── index

worktree A/
├── Working directory files
└── .git (regular file)
    └── Content: gitdir: Main worktree/.git/worktrees/<id-a>

worktree B/
├── Working directory files
└── .git (regular file)
    └── Content: gitdir: Main worktree/.git/worktrees/<id-b>
```

- The same local branch can by default only be used in one worktree. Each worktree has its own `HEAD`, but local branch references are shared by the repository. If you force the `HEAD` of two worktrees to simultaneously point to the same local branch, creating a commit in one will move the branch forward; the other worktree's `HEAD` immediately points to the new commit, but its index and working directory retain the previous contents. At this point Git will show staged differences not resulting from actual edits, and continuing to commit may produce a commit that undoes the previous modification.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `-b <new-branch>` | Create `<new-branch>`, and have new worktree use this branch |
| `-d`, `--detach` | Have new worktree's `HEAD` point directly to a commit, not using a local branch |
| `-n`, `--dry-run` | Only show records that `prune` would clean up |

```bash
# Purpose: View all worktrees associated with the repository
git worktree list

# Purpose: Create a new branch from a specified starting point, and create a worktree for it
# Conditions: Working directory where command is executed can be clean or unclean
# Result: Creates a new branch starting from <commit-ish>, and establishes a worktree for it at <path>
git worktree add -b <new-branch> <path> [<commit-ish>]
# Example 1: Create hotfix/example branch starting from origin/main, establish worktree in adjacent project-hotfix/
git worktree add -b hotfix/example ../project-hotfix origin/main
# Example 2: Create feature/example branch starting from current HEAD, establish worktree in adjacent project-feature/
git worktree add -b feature/example ../project-feature
# Example 3: Create hotfix/v1.2.1 branch starting from v1.2.0, establish worktree in adjacent project-hotfix-v1.2.1/
git worktree add -b hotfix/v1.2.1 ../project-hotfix-v1.2.1 v1.2.0

# Purpose: Create a worktree for an existing local branch
# Conditions: Working directory can be clean or unclean; <branch> is not used by other worktrees
# Result: Establishes a worktree using <branch> at <path>; uncommitted modifications and staged content from original working directory are not copied over
git worktree add <path> <branch>
# Example 1: Establish a worktree using branch release/1.x in adjacent project-release/
git worktree add ../project-release release/1.x

# Purpose: Create a temporary worktree not bound to a branch for a specific version, used for inspecting old versions, testing, or executing bisect
# Conditions: Working directory where command is executed can be clean or unclean
# Result: Establishes worktree at <path>, its HEAD points directly to specified commit in detached HEAD state; original working directory state remains unchanged
git worktree add --detach <path> <commit-ish>
# Example 1: Directly use abbreviated commit ID to establish temp worktree pointing to 9f3a2c1 in adjacent project-inspect-commit/
git worktree add --detach ../project-inspect-commit 9f3a2c1
# Example 2: Establish temp worktree pointing to commit referenced by tag v1.2.0 in adjacent project-inspect-tag/
git worktree add --detach ../project-inspect-tag v1.2.0

# Purpose: Remove a linked worktree no longer needed, but keep its branch and commits
# Conditions: Working directory can be clean or unclean; target must be clean, unlocked, and have no submodules
# Result: Deletes <worktree> working directory and its management records, does not delete corresponding branch and commits
git worktree remove <worktree>
# Example 1: Remove adjacent project-hotfix/ worktree
git worktree remove ../project-hotfix

# Purpose: Preview invalid worktree management records that can be cleaned up
# Conditions: Working directory can be clean or unclean; needs to be executed within any worktree of the repository
# Result: Lists management records where working directory no longer exists and meets cleanup conditions, without actually deleting
git worktree prune --dry-run

# Purpose: Clean up invalid worktree management records
# Conditions: Working directory can be clean or unclean; needs to be executed within any worktree of the repository
# Result: Deletes management records where working directory no longer exists and meets cleanup conditions, doesn't delete existing worktrees, branches, or commits
git worktree prune

# Purpose: Repair invalidated associations after manually moving main worktree or linked worktree
# Conditions: Working directories of execution and target can be clean or unclean; new path must be provided if moving linked worktree
# Result: Re-establishes bidirectional association between repository management directory and corresponding worktree, doesn't change files, branches, or commits
git worktree repair [<path>...]
# Example 1: Repair a linked worktree already manually moved to ../project-hotfix/
git worktree repair ../project-hotfix
```

## cherry-pick: Apply Specific Commits

`cherry-pick` reads the modifications introduced by an existing commit, applies them to the current branch, and by default creates a new commit with the corresponding content but a different commit ID. It is suitable for moving isolated fixes into other branches without merging the entire history leading up to the original commit.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `-n`, `--no-commit` | Do not automatically create a commit |

```bash
# Purpose: Introduce an existing commit into the current branch
# Conditions: Current working tree must be clean
# Result: Applies modifications introduced by target commit, and creates a new commit on current branch
git cherry-pick <commit-ish>
# Example 1: Introduce commit 9f3a2c1 into current branch
git cherry-pick 9f3a2c1

# Purpose: Apply an existing commit's modifications, but don't immediately create a commit
# Conditions: Index must not contain unresolved merge conflicts; existing local modifications must not be overwritten by target modifications
# Result: Writes target modifications to working directory and index, HEAD and current branch remain unchanged
git cherry-pick --no-commit <commit-ish>
# Example 1: Apply modifications of commit 9f3a2c1, check or adjust before manually committing
git cherry-pick --no-commit 9f3a2c1
```

## revert: Revert Specific Commits with a New Commit

`revert` creates a new commit that undoes the target commit, without deleting or rewriting the original commit, making it suitable for reverting history that has already been shared.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `-m <parent-number>`, `--mainline <parent-number>` | Specify the parent commit numbered `<parent-number>` as the mainline |
| `--no-patch` | When used with `git show`, do not display file patches |
| `--pretty=raw` | When used with `git show`, display commit metadata in raw format |

```bash
# Purpose: Revert modifications introduced by an ordinary commit
# Conditions: Current working tree must be clean
# Result: Creates a new commit that undoes the target commit, original commit and existing history remain unchanged
git revert <commit-ish>
# Example 1: Revert commit 9f3a2c1 with a new commit
git revert 9f3a2c1

# Purpose: Revert a merge commit; due to multiple parents, -m must specify which mainline to keep
# Conditions: Current working tree must be clean; target is a merge commit; <parent-number> corresponds to one of its parents
# Result: Reverses the changes of the merge relative to that parent commit; does not revert that parent, nor delete the original merge commit
git revert -m <parent-number> <merge-commit>
# Example 1: Check parent order first, then keep the mainline represented by the first parent and revert the merge
git show --no-patch --pretty=raw 6d8f2a1
git revert -m 1 6d8f2a1
# Note: Revert only reverses content, original merge relationship still exists; merging again won't automatically restore the reverted content
```

## reset: Reset HEAD and File State

`reset` moves the current branch or detached HEAD to a specified commit, and decides whether to simultaneously reset the index and working directory based on the mode. It is suitable for tidying up local states that haven't been shared; if related commits have already been used by others, moving the branch will rewrite the history they rely on.

The meanings of three common command-line parameters are as follows:

| Parameter | Current Branch or `HEAD` | Index | Working Directory |
| --- | --- | --- | --- |
| `--soft` | Moved to target commit | Remains unchanged | Remains unchanged |
| `--mixed` | Moved to target commit | Reset to target commit content | Remains unchanged |
| `--hard` | Moved to target commit | Reset to target commit content | Reset to target commit content |

```bash
# Purpose: Move current branch, while keeping contents in index and working directory
# Conditions: Index must not contain unresolved merge conflicts
# Result: Current branch or detached HEAD moved to target commit; index and working directory remain unchanged
git reset --soft <commit-ish>
# Example 1: Retract current commit, while keeping its modifications in a staged state
git reset --soft HEAD^

# Purpose: Move current branch and cancel staged state after target commit
# Conditions: Current working tree can be clean or unclean
# Result: Current branch or detached HEAD moved to target commit, index reset to target content, working directory remains unchanged
git reset --mixed <commit-ish>
# Example 1: Retract current commit and cancel staged state of its modifications, but keep file modifications
git reset --mixed HEAD^

# Purpose: Make current branch, index, and tracked files all return to specified commit
# Conditions: Current working tree can be clean or unclean
# Result: Current branch or detached HEAD moved to target commit; index and tracked files overwritten by target content, blocking untracked paths might also be deleted
git reset --hard <commit-ish>
# Example 1: Retreat current branch to previous commit, and discard uncommitted modifications in index and working directory
git reset --hard HEAD^
```

`reset --hard` will discard uncommitted modifications to tracked files, and should not be used for ordinary cleanup.

## reflog: View Reference Log

`reflog` (reference log) records where branches and other references in the local repository previously pointed. It differs from commit history: commit history saves parent-child relationships between commits, while reflog saves the movement of references due to local operations. `git reflog` by default shows the reference log of `HEAD`, which also records branch switches; viewing a specific branch's reflog only reflects the movements of that branch reference itself.

Reflogs only exist locally and are not synchronized between repositories via `fetch`, `pull`, or `push`. As long as the corresponding record hasn't expired and the target object still exists, commits no longer pointed to by the current branch or tags can be accessed via reflog.

Reflog positions are expressed using `<ref>@{<specifier>}`:

| Notation | Meaning |
| --- | --- |
| `<ref>@{0}` | The value of `<ref>` after the most recent recorded move, usually its current value |
| `<ref>@{<n>}` | The position `<ref>` was in `<n>` moves ago; numbering starts from `0` |
| `<ref>@{<date>}` | The position `<ref>` was in at a specified time; based on reference update time, not commit creation time |
| `HEAD@{2}` | The position `HEAD` was in two moves ago |
| `main@{yesterday}`| The position local `main` was in yesterday |
| `main@{one.week.ago}` | The position local `main` was in a week ago |

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `-n <count>` | Show at most `<count>` records |
| `--date=<format>` | Show record times according to `<format>` |

```bash
# Purpose: View update records for HEAD or specified reference
# Result: Shows reflog position, commit ID, and operation description in reverse chronological order, changes no references
git reflog show [-n <count>] [--date=<format>] [<ref>]
# Example 1: Show recent 10 update records of HEAD in local time
git reflog show -n 10 --date=local HEAD
# Example 2: Show recent 5 update records of main
git reflog show -n 5 main

# Purpose: List references in current repository that have a reflog
# Result: Outputs reference names, changes no reflog or references
git reflog list

# Purpose: Check if specified reference has a reflog
# Result: Returns exit status 0 if exists, non-zero otherwise; does not output reflog content
git reflog exists <ref>
# Example 1: Check if local main branch has a reflog
git reflog exists refs/heads/main

# Purpose: Inspect an old position recorded in reflog
# Conditions: Specified record has not expired, and the Git object it points to still exists
# Result: Shows the commit corresponding to that position and its patch, does not move any references
git show <ref>@{<specifier>}
# Example 1: Inspect the commit HEAD pointed to two moves ago
git show HEAD@{2}

# Purpose: Retain a commit found in reflog as a new branch
# Conditions: Specified record and its commit still exist; <new-branch> must not exist
# Result: Creates a new branch pointing to that commit, does not switch branches, does not move existing references
git branch <new-branch> <ref>@{<specifier>}
# Example 1: Retain the commit HEAD pointed to two moves ago as rescue/example
git branch rescue/example HEAD@{2}
```

Reflog is not a permanent backup. By default, records reachable from current references are controlled by `gc.reflogExpire`, kept for 90 days by default; records unreachable from current references are controlled by `gc.reflogExpireUnreachable`, kept for 30 days by default. Actual durations can be modified via configuration; after records expire, if the corresponding commits are no longer protected by other references or reflogs, they might later be deleted by garbage collection. Daily viewing and recovery do not require directly executing `reflog expire`, `delete`, or `drop`.

## bundle: Bundle Repository History

`bundle` writes references and their reachable Git objects into a single file, which can transmit repository data offline or via alternative media without network access. Self-contained bundles contain complete history and can be directly cloned; incremental bundles only contain new commits after a designated base, and the receiving repository must already possess the prerequisite commits.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `--all` | Pack all references |

```bash
# Purpose: Create a self-contained bundle
# Conditions: Execution working directory can be clean or unclean; can pack all references or specified branch
# Result: Writes self-contained repository data into <file>
git bundle create <file> <git-rev-list-args>
# Example 1: Pack all references in current repository into project.bundle
git bundle create project.bundle --all
# Example 2: Only pack history of main branch into main.bundle
git bundle create main.bundle main

# Purpose: Create an incremental bundle
# Conditions: Current repository must possess the specified new commits and base commits
# Result: Writes only the history from <base> to <new-commit> into <file>
git bundle create <file> <base>..<new-commit>
# Example 1: Create an incremental bundle from v1.0.0 up to main
git bundle create update.bundle v1.0.0..main

# Purpose: Verify if a bundle is valid and complete
# Conditions: Execute within a Git repository; when verifying incremental bundles, should execute in receiving repository
# Result: Checks file integrity, and lists prerequisite commits missing in current repository; imports no objects
git bundle verify <file>
# Example 1: Verify project.bundle
git bundle verify project.bundle

# Purpose: Create new repository from a self-contained bundle
# Conditions: <file> must be a bundle with no missing prerequisite commits, <directory> must not be an existing non-empty directory
# Result: Creates new repository in <directory> containing bundle history
git clone <file> <directory>
# Example 1: Create project/ repository from project.bundle
git clone project.bundle project

# Purpose: View references provided by a bundle
# Result: Shows readable references and their commit IDs within, imports no objects
git ls-remote <file>
# Example 1: View references provided by project.bundle
git ls-remote project.bundle

# Purpose: Fetch specified reference from bundle
# Conditions: Execute in receiving repository; repository must possess bundle's prerequisite commits
# Result: Imports required objects, and updates local reference according to refspec
git fetch <file> <source-ref>:<destination-ref>
# Example 1: Fetch main branch of project.bundle as bundle/main remote-tracking reference
git fetch project.bundle refs/heads/main:refs/remotes/bundle/main
```

## archive: Archive Versioned Files

`archive` generates a source code package from a specified commit, tag, or tree object. By default it only reads tracked files in that version, and does not include `.git`, uncommitted modifications, or untracked files.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `--format=<format>` | Set archive format to `<format>` |
| `--prefix=<prefix>/` | Prepend `<prefix>/` to paths inside the archive |
| `-o <output>`, `--output=<output>` | Write archive to `<output>` |

```bash
# Purpose: Export specified version as a source package
# Conditions: Execution working directory can be clean or unclean
# Result: Writes files in specified version to <output>, and prepends <prefix>/ to paths inside the package
git archive --format=<format> --prefix=<prefix>/ -o <output> <tree-ish>
# Example 1: Export v1.2.0 tag as project-1.2.0.tar.gz
git archive --format=tar.gz --prefix=project-1.2.0/ -o project-1.2.0.tar.gz v1.2.0
```

`.gitignore` indirectly affects archive contents: files ignored and not added to the repository are not in the commit, so naturally `git archive` won't export them. But `.gitignore` cannot exclude files that already exist in the archived version; to exclude such tracked paths from release packages, set `export-ignore` in the `.gitattributes` of that version:

```text
.github/** export-ignore
tests/** export-ignore
```

## bisect: Binary Search to Locate Commits Introducing Changes

`bisect` is used to find the location where state changed between a commit known to be `good` and a commit known to be `bad`. Git selects a candidate commit each time; after marking it as `good`, `bad`, or `skip`, Git narrows the range and selects the next candidate commit, until the boundary is located.

The entire process must use the same judgment standard, and the target state should only change from `good` to `bad` once within the selected range. Commits that cannot be reliably judged should be marked as `skip`; if such commits are adjacent to the boundary, Git might only be able to provide multiple candidate commits.

```bash
# Purpose: Specify bad and good boundaries and start bisection
# Conditions: Both boundaries have been verified; working directory can safely switch commits
# Result: Records HEAD before starting, and switches to first candidate commit
git bisect start <bad> <good>
# Example 1: Start bisect between current commit and v1.0.0
git bisect start HEAD v1.0.0

# Purpose: Mark current candidate commit as good/normal
# Conditions: bisect in progress, and current commit confirmed good
# Result: Updates good boundary, and switches to next candidate or reports result
git bisect good

# Purpose: Mark current candidate commit as bad/abnormal
# Conditions: bisect in progress, and current commit confirmed bad
# Result: Updates bad boundary, and switches to next candidate or reports result
git bisect bad

# Purpose: Skip candidate commit that cannot currently be reliably judged
# Conditions: bisect in progress, and current commit cannot be classified as good or bad
# Result: Selects other candidate commit; may not determine unique result if skips are near boundary
git bisect skip

# Purpose: End bisection
# Conditions: bisect in progress
# Result: Clears bisection state, and restores branch or commit position before bisection started
git bisect reset
```

When state can be stably judged using a command or script, `git bisect run` can automatically test each candidate commit:

| Test Command Exit Status | Judgment |
| --- | --- |
| `0` | `good` |
| `1`–`127`, excluding `125` | `bad` |
| `125` | `skip` |
| Other values | Abort bisect |

```bash
# Purpose: Automatically test candidate commits with specified command
# Conditions: bisect in progress; command can return stable exit status as agreed
# Result: Repeatedly tests and marks candidate commits, until boundary located or bisect aborted
git bisect run <command> [<argument>...]
# Example 1: Automatically test candidates using script outside repository
git bisect start HEAD v1.0.0
git bisect run ../test-regression.sh
git bisect reset
```

The test command must be executable across candidate commits. It should only return `bad` when the target state occurs; build failures or environmental issues unrelated to the target should return `125`.

```bash
# Purpose: Output operation records of current bisection process
# Conditions: bisect in progress
# Result: Outputs records for inspection, saving, or replay usage, changes no bisect state
git bisect log
# Example 1: Save records to a file outside repository
git bisect log > ../bisect.log

# Purpose: Restore bisect progress from existing records
# Conditions: <log-file> is valid record generated by git bisect log; working directory can safely switch commits
# Result: Replays start, good, bad, and skip operations from records
git bisect replay <log-file>
# Example 1: Restore bisect progress from saved records
git bisect reset
git bisect replay ../bisect.log
```

## maintenance: Maintain Repository Data

`maintenance` is used to tidy up accumulating repository data such as commits, objects, pack files, and references, to shorten the time required for history traversal, object fetching, and reference reading. It is not aimed at modifying project files in the working directory, and the working directory can be clean or unclean when executed.

When maintaining large or frequently updated repositories long-term, you usually don't need to choose maintenance tasks individually. The most direct entry point is `git maintenance start`: it adds the current repository to the user-level maintenance list, and establishes a background scheduler shared by all registered repositories. If no maintenance strategy was configured before, Git adopts the `incremental` strategy, whose actual scheduling is as follows:

| Frequency | Automatically Executed Tasks | Actual Effect |
| --- | --- | --- |
| Hourly | `commit-graph`, `prefetch` | Updates commit graph; prefetches remote objects to `refs/prefetch/`, but doesn't move ordinary remote-tracking branches |
| Daily | `loose-objects`, `incremental-repack` | Batches and packs loose objects, gradually merges smaller pack files |
| Weekly | `pack-refs` | Tidies loose references, speeds up traversal of large numbers of references |

This strategy does not schedule comprehensive `gc`. `prefetch` will access the remote repository, but will not update ordinary remote-tracking branches or tags; when executing a routine `fetch` later, the objects needing transmission will usually be fewer.

Command-line parameters used in this section:

| Parameter | Meaning |
| --- | --- |
| `--task=<task>` | Only run specified task; can be reused, and executes in given order |
| `--auto` | Only run when repository state reaches corresponding task's trigger threshold |
| `--scheduler=<scheduler>` | Specify `auto`, `crontab`, `systemd-timer`, `launchctl`, or `schtasks` for `start` |
| `--global` | When used with `git config`, read current user's global configuration |
| `--get-all <name>` | Output all values for configuration item `<name>` |
| `--unset <name>` | Delete configuration item `<name>` |

```bash
# Purpose: Start scheduled maintenance for current repository
# Conditions: Execution working directory can be clean or unclean; available scheduler exists in OS
# Result: Registers current repository, sets to incremental if no strategy configured, turns off auto-maintenance triggered by regular Git commands, and creates or updates user-level background schedule
git maintenance start [--scheduler=<scheduler>]
# Example 1: Let Git automatically choose scheduler based on OS
git maintenance start --scheduler=auto

# Purpose: Add another repository to maintenance list without altering existing scheduler
# Conditions: Execute in repository to be added; working directory can be clean or unclean
# Result: Registers current repository and completes same repository configuration as start, but doesn't create or start scheduler
git maintenance register
# Example 1: Scheduler already started by other repositories, add adjacent project-b to same maintenance list
cd ../project-b
git maintenance register

# Purpose: View registered repositories
# Result: Outputs all maintenance.repo values in current user's global config
git config --global --get-all maintenance.repo

# Purpose: Stop scheduled maintenance only for current repository
# Conditions: Current repository already registered; working directory can be clean or unclean
# Result: Removes current repository from maintenance list, other repositories and scheduler remain unchanged; maintenance.auto=false is still retained
git maintenance unregister
# Optional: Restore default behavior of regular Git commands triggering auto-maintenance as needed
git config --unset maintenance.auto

# Purpose: Pause scheduled maintenance for all registered repositories
# Conditions: Working directory can be clean or unclean
# Result: Stops and removes shared user-level scheduler, but retains maintenance list; executing start later can continue processing these repositories
git maintenance stop

# Purpose: Manually run specified tasks for explicit issues
# Conditions: Execution working directory can be clean or unclean; each <task> must be a supported task name
# Result: Only executes specified tasks in order of appearance, doesn't run other tasks
git maintenance run --task=<task> [--task=<task>...]
# Example 1: After importing massive commits, immediately update commit-graph
git maintenance run --task=commit-graph
# Example 2: Repository accumulated many loose objects and small pack files, execute incremental repack
git maintenance run --task=loose-objects --task=incremental-repack
# Example 3: When a full tidy is needed, run gc alone; don't put loose-objects in the same maintenance run
git maintenance run --task=gc

# Purpose: Only run task when repository reaches corresponding maintenance threshold
# Conditions: Execution working directory can be clean or unclean
# Result: Executes maintenance when threshold reached, otherwise doesn't alter repository data
git maintenance run --auto
```

A comprehensive `gc` might take a long time, and might also clean up data that has passed its retention period and is unreachable. After enabling `start`, there is usually no need to manually run the above tasks anymore; explicitly specifying `--task` is mainly used for immediately addressing confirmed repository data issues.
