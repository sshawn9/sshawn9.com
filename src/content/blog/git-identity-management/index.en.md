---
title: Git Identity Management
description: Differentiate between Git commit identity, GitHub CLI accounts, remote authentication, and commit signatures, and establish verifiable configurations for single-account, multi-account, and multi-platform environments.
---

When using Git for the first time, most people only set a single name and email in the global configuration. This usually isn't an issue when using only one hosting account. However, when the same computer starts hosting both personal and work repositories, uses GitHub and Gitee separately, or uses multiple accounts on the same platform, a single global default is no longer suitable for all repositories.

At this point, two types of mismatches often occur: code can be pushed normally, but the commit records the wrong name or email; or the commit identity is correct, but a different account is used to access the remote repository. Git cannot automatically switch identities based on usage scenarios like "personal repository" or "work repository" because creating commits and accessing remote repositories are two independent mechanisms.

When creating a commit, Git writes the name and email into the commit; when accessing a remote repository, an SSH key or HTTPS credentials prove the account's identity to the hosting platform; if commit signing is enabled, a signing key is also chosen. The GitHub CLI (`gh`) maintains its own active account for the GitHub API and command-line operations. A multi-identity configuration establishes the correct correspondence between these pieces of information for each repository.

## Identities in the Git Workflow

A typical GitHub workflow involves four types of identity information:

| Operation | Actual Identity Information Used | Primary Source |
| --- | --- | --- |
| Creating commits | Author and committer's name, email | `user.name`, `user.email`, and related environment variables |
| `git fetch`, `push`, `clone` | Account credentials recognized by remote service | SSH key or HTTPS credential helper |
| `gh pr`, `repo`, `api` | GitHub CLI active account | `gh auth login`, `gh auth switch`, or environment variables |
| Signing commits or tags | Key used to generate digital signatures | `user.signingKey`, signature format, and signing program |

`user.name` and `user.email` are merely commit metadata, not login credentials for platforms like GitHub or GitLab. Modifying these two configurations does not switch the SSH key, nor does it replace HTTPS credentials; successfully pushing to a repository accessible by a certain account does not prove that the name and email recorded in the commit are correct.

A commit object records both the author and the committer. The author indicates the original creator of the changes, while the committer indicates the person who created the current commit object. These two sets of information are usually the same in an ordinary commit; operations like `cherry-pick` or `rebase` might preserve the author information while recording the committer information with the current identity.

`gh` is not a unified account switch for Git. It can call the GitHub API and serve as Git's HTTPS credential helper, but it does not modify the name and email in commits, nor does it choose a signing key for Git. Commit signatures also do not participate in remote logins; you only need to configure signatures when you need to prove that a commit or tag was signed by the holder of a specific key.

## Sources of Commit Identity Configuration

Git reads configurations from scopes such as system, global, local, worktree, and command, in that order. For single-value configurations like `user.name` and `user.email`, the subsequently read valid value usually overwrites the previous one. User-level configurations are located in `~/.gitconfig` or `$XDG_CONFIG_HOME/git/config`, while repository-level local configurations are located in the `config` file within the Git directory.

`includeIf` can load another configuration file when conditions are met. The loaded content is inserted at the location of the `includeIf`, and it does not constitute a new scope itself. Therefore, an identity file loaded in the global configuration still belongs to the global scope, and the repository's local configuration can still overwrite it.

Multi-identity configurations commonly use three selection criteria:

| Selection Criteria | Applicable Scenarios | Boundaries |
| --- | --- | --- |
| `gitdir:` | Repositories can be categorized by directories (e.g., personal, work) | Repositories must be located under agreed-upon directories |
| `hasconfig:remote.*.url:` | Repositories are scattered, but remote addresses have stable characteristics | Cannot match before adding a remote address; loaded files cannot define remote URLs |
| Repository local config | A few exceptional repositories | Needs to be maintained repository by repository |

`onbranch:` changes with the current branch and is suitable for branch-related configurations, but not for representing a long-term identity used by a repository.

For repositories that can be uniformly organized into directories, the `gitdir:` rule is the most straightforward: it takes effect before remote addresses are created, and it's easy to determine the matching scope when moving or copying configurations. Repository-level configuration is reserved for exceptions, rather than having each repository repeatedly save a set of identical identities.

## Choosing an Authentication Method

Commit identity can always be selected by directory using `includeIf`; what truly needs to be decided based on usage scenarios is remote authentication and `gh`'s account selection method.

| Usage Scenario | Suggested Solution | Account Selection Method |
| --- | --- | --- |
| Using only one GitHub account | `gh` manages HTTPS credentials | Used continuously after logging in once |
| Using both GitHub and Gitee | Organize directories by host using `ghq`; authenticate separately | `gh` for GitHub, specific SSH or HTTPS for Gitee |
| Occasionally switching accounts on the same GitHub host | `gh` manages HTTPS credentials | Use `gh auth switch` before operating to switch active account |
| Multiple GitHub accounts needed long-term in parallel | Git uses SSH host aliases, `gh` manages API accounts separately | Fixed SSH key per remote URL; `gh` still works by active account |
| Must use HTTPS and fix accounts per repository | Use multi-account credential helpers like Git Credential Manager | Explicitly write the account in the remote URL |

`gh + HTTPS` is the most concise path for a single GitHub account and is also one of the official HTTPS credential solutions recommended by GitHub. It can also save multiple accounts on the same host, but currently adopts a "one active account per host" model, rather than "automatically binding one account per repository". Therefore, when frequently using multiple GitHub accounts in parallel, SSH host aliases still have a clear and stable repository-level selection capability and have not become obsolete due to the emergence of `gh`.

## Configuring Commit Identity and Authentication

The following uses personal and work repositories divided by directories as a common basis. Directories are responsible for selecting commit identities, while remote authentication chooses `gh + HTTPS`, SSH host aliases, or other HTTPS credential helpers based on the scenarios in the previous section. The two do not depend on each other and should be checked separately.

```text
~/code/personal/    Personal repositories
~/code/work/        Work repositories
```

### Commit Identity

The global configuration `~/.gitconfig` only saves selection rules and security constraints:

```ini
[user]
    useConfigOnly = true

[includeIf "gitdir:~/code/personal/"]
    path = ~/.config/git/personal.inc

[includeIf "gitdir:~/code/work/"]
    path = ~/.config/git/work.inc
```

A `gitdir:` pattern ending in `/` will match all repositories in that directory, including deeper subdirectories. If path casing is unstable, `gitdir/i:` can be used for case-insensitive matching.

Personal identity configuration `~/.config/git/personal.inc`:

```ini
[user]
    name = Example User
    email = personal@example.com
```

Work identity configuration `~/.config/git/work.inc`:

```ini
[user]
    name = Example User
    email = user@company.example
```

`user.useConfigOnly = true` prevents Git from guessing the name or email based on the system username and hostname. With the above configuration, if a repository does not match any identity file and no local identity is set, Git will require the identity to be completed when creating a commit, rather than silently using a guessed value.

A few exceptions can be written directly to the current repository:

```bash
git config --local user.name "Example User"
git config --local user.email "another-address@example.com"
```

Local configurations only affect the current repository, are not written into the commit history, and are not pushed to remote repositories along with project files.

### GitHub CLI and HTTPS

GitHub officially recommends using GitHub CLI or Git Credential Manager to save HTTPS credentials, rather than writing access tokens into remote URLs or plain configuration files. The regular configuration process using `gh` only requires starting from the login command:

```bash
gh auth login
```

Follow the interactive prompts to choose GitHub.com, HTTPS, and browser login; if prompted whether to authenticate Git with your GitHub credentials, choose confirm. After authentication is complete, `gh` will automatically log in to the GitHub CLI, save the token, record the host's preferred Git protocol, and complete Git's HTTPS credential setup.

In actual use, the configuration usually ends here: subsequent `gh repo`, `gh pr`, `gh api` commands can directly call the GitHub API, and `git clone`, `git pull`, and `git push` using HTTPS remotes do not require creating or pasting access tokens again.

Tokens obtained from web logins are preferentially saved in the system credential store; if the system has no available credential store, `gh` will fall back to its own configuration file. The current logged-in account, token status, and saving method can be viewed via `gh auth status`; you should not use `--show-token` to record or share the actual token.

If you did not agree to configure credentials for Git during login, the related configuration was later deleted, or you explicitly want Git to directly call `gh` for credentials, you can execute separately:

```bash
gh auth setup-git --hostname github.com
```

This is a supplementary or repair command, not the second step in a normal login flow.

After configuration is complete, normal HTTPS remotes do not need to include an account or token in the URL:

```bash
git clone https://github.com/example-user/project.git ~/code/personal/project
git push origin main
```

When not overridden by environment variables, the GitHub CLI directly uses `gh`'s active account. Which account Git's HTTPS operations use also depends on the credential helper that is ultimately active. `gh auth login` can reuse existing credential helpers on the computer; only when Git's effective configuration points to `gh auth git-credential` will Git read `gh`'s active account every time it needs credentials:

```text
gh pr, gh repo, gh api
└── gh directly uses the token of the active account

git fetch, git push, git clone https://github.com/...
└── Git calls the credential helper
    └── gh auth git-credential returns the token of the active account
```

You can independently check the login, protocol, credential helper, and remote address:

```bash
gh auth status --active --hostname github.com
gh config get git_protocol --host github.com
git config --show-origin --get-all credential.https://github.com.helper
git remote get-url origin
```

If the remote address starts with `https://github.com/`, and `gh auth git-credential` appears in the credential helper, then the repository uses `gh + HTTPS`. This only indicates the remote authentication method; the commit identity is still determined by `user.name` and `user.email`.

If the effective credential helper is Git Credential Manager, the system keychain, or another program, `gh auth login` can still hand the GitHub credentials over to it for safekeeping during login, but subsequent Git operations are managed by that helper. In this case, `gh auth switch` will certainly switch the GitHub CLI's account, but it does not equate to synchronously switching the external credential helper to the account returned for Git.

#### Multi-Account Switching in `gh`

`gh auth login` can continue adding accounts under the same GitHub host and will set the newly logged-in account as the active account. `gh auth status` lists all saved accounts and the current active account; you only need to execute `gh auth switch` when you need to switch to another saved account:

```bash
# Log in to another GitHub account again; upon success, this account automatically becomes the active account
gh auth login

gh auth status --hostname github.com

# Execute only when needing to switch back to the previously saved personal account
gh auth switch --hostname github.com --user personal-user
```

`gh auth switch` changes the active account for the `github.com` host. It affects subsequent `gh` commands; when `gh` is already acting as Git's credential helper, it also changes the token obtained by subsequent Git HTTPS operations. This selection acts on the host, not the current repository: after switching to the work account, HTTPS operations for other GitHub repositories will also use the work account until switched again.

Therefore, this method is suitable for having only one GitHub account or only occasionally switching between multiple accounts. It is not suitable for tying personal and work accounts to different repositories long-term and automatically. Organizations or repository paths in remote URLs will not make `gh` automatically select the corresponding account.

`gh`'s `git_protocol` is also saved per host and shared by all logged-in accounts under that host. It determines the protocol `gh` prefers when creating or cloning repositories, but it will not rewrite the remote URLs of existing repositories; whether an existing remote uses HTTPS or SSH still depends on the result of `git remote get-url`.

Environment variables like `GH_TOKEN` or `GITHUB_TOKEN` take precedence over credentials saved by `gh` and are primarily used in automated environments. When troubleshooting local account mismatches, you also need to confirm whether the current shell has these variables set.

### Typical Scenario: Managing GitHub and Gitee with `ghq`

A common usage is to save GitHub and Gitee repositories on the same computer simultaneously: GitHub uses `gh` to log in, and Gitee configures authentication separately. `ghq` conveniently organizes directories by the host, owner, and repository name of the remote address, so it can directly provide stable path boundaries for `includeIf`.

First, check the root directory used by `ghq`:

```bash
ghq root
```

The following uses the default `~/ghq` as an example. After cloning via `ghq get`, the repositories from the two platforms will naturally separate:

```text
~/ghq/
├── github.com/
│   └── example-user/
│       └── project/
└── gitee.com/
    └── example-user/
        └── project/
```

`ghq` is not responsible for choosing the commit identity or login account; its role is to automatically establish this directory structure based on remote addresses. `~/.gitconfig` can leverage this directory structure to load different identities:

```ini
[includeIf "gitdir:~/ghq/github.com/"]
    path = ~/.config/git/github.inc

[includeIf "gitdir:~/ghq/gitee.com/"]
    path = ~/.config/git/gitee.inc
```

If both platforms use the same name, email, and signature settings, the two rules can load the same identity file; if the identities differ, write them to `github.inc` and `gitee.inc` respectively.

#### GitHub: Login with `gh`, Clone with `ghq`

For the first use, execute `gh auth login` once, select HTTPS, and agree to configure credentials for Git. Thereafter, hand the HTTPS address to `ghq`:

```bash
ghq get https://github.com/example-user/project.git
```

`ghq` actually calls Git to perform the clone and places the repository into:

```text
~/ghq/github.com/example-user/project/
```

The repository's `origin` saves the original GitHub HTTPS address. Subsequent `git pull` and `git push` commands obtain the credentials saved by `gh` via Git's credential helper, eliminating the need to log in again or write the account in the command.

#### Gitee: Independent Authentication Configuration

`gh` only handles GitHub and cannot log in for Gitee. Gitee can use SSH separately; when only one account is used per platform, just configure the key for the real host:

```text
Host gitee.com
    User git
    IdentityFile ~/.ssh/id_ed25519_gitee
    IdentitiesOnly yes
```

Then use Gitee's SSH address:

```bash
ghq get git@gitee.com:example-user/project.git
```

The repository will be placed into:

```text
~/ghq/gitee.com/example-user/project/
```

Later, upon entering this repository, `git pull` and `git push` will automatically use Gitee's SSH key based on `gitee.com` in `origin`. You can also switch to Gitee HTTPS addresses and a credential helper; its credential records are separated from GitHub's by hostname.

Daily operations for both platforms are exactly the same:

```bash
git pull
git push
```

Directories allow `includeIf` to automatically select the commit identity, the hostname in `origin` allows Git to automatically select the remote platform, and SSH or a credential helper selects the corresponding credentials. The full remote address is only needed during the initial clone.

#### Pushing the Same Repository to Two Platforms

This is a different independent scenario: the same local repository needs to be pushed to both GitHub and Gitee simultaneously. Only in this situation is it necessary to name the two remotes separately:

```bash
git remote add github https://github.com/example-user/project.git
git remote add gitee git@gitee.com:example-user/project.git

git push github main
git push gitee main
```

If the repositories on the two platforms are mutually independent projects, then they both use their respective default `origin`s, and the above configuration is not needed.

### Fixing Multiple GitHub Accounts with SSH

This section deals with only one situation: the same computer needs to use two GitHub accounts in parallel long-term. If you only have one GitHub account, or if you are using two different platforms like GitHub and Gitee, the host aliases here are not needed.

SSH proves account identity via keys. The host accessed by two GitHub accounts is `github.com` in both cases, so you first need to define two local names for the same host, and then have each name fixate on a key:

`~/.ssh/config`:

```text
# Local name github-personal → github.com → personal key
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes

# Local name github-work → github.com → work key
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes
```

The name after `Host` is only used locally; `HostName` is the server actually connected to. `IdentityFile` specifies the private key used by this name, and `IdentitiesOnly yes` prevents other loaded keys in `ssh-agent` from being attempted simultaneously.

Whichever local name is written in the repository's remote address dictates which key SSH uses:

```text
git@github-work:example-org/project.git
        │
        └─ Matches Host github-work
             └─ Connects to github.com
                  └─ Uses id_ed25519_work
                       └─ Recognized by GitHub as the work account
```

You only need to choose once when cloning the repository:

```bash
git clone git@github-personal:example-user/project.git \
  ~/code/personal/project

git clone git@github-work:example-org/project.git \
  ~/code/work/project
```

`git clone` will save the source address as `origin`. When you enter the repository later, execute standard Git commands directly without needing to specify the account or key again:

```bash
git pull
git push
```

For existing repositories, simply modify `origin` once:

```bash
git remote set-url origin \
  git@github-work:example-org/project.git
```

Directories and remote addresses solve two different problems: `~/code/work/` selects the name, email, and signature recorded in commits via `includeIf`; `github-work` in `origin` selects the GitHub account used during pushing. Both will take effect automatically once configured.

When pushing via SSH, Git does not read `gh`'s active account; commands like `gh pr` and `gh repo` still use `gh`'s active account. When you need to call the GitHub API with another account, execute `gh auth switch` then.

### Multiple GitHub Accounts Must Use HTTPS

When one GitHub account uses HTTPS, the earlier `gh auth login` is sufficient. When multiple GitHub accounts need long-term binding to different repositories, SSH host aliases are generally more direct; you only need a multi-account credential helper like Git Credential Manager when the environment mandates HTTPS.

Public GitHub usernames can be written into remote addresses so the credential helper knows which account's credentials to read:

```bash
git clone \
  https://personal-user@github.com/example-user/project.git \
  ~/code/personal/project

git clone \
  https://work-user@github.com/example-org/project.git \
  ~/code/work/project
```

Here `personal-user` and `work-user` are just usernames, not access tokens. Upon first access, the credential helper completes web login and saves the token to the system's secure storage; afterward, you still only need to use `git pull` and `git push`.

You can use the following command to view currently active credential configurations and their sources:

```bash
git config --show-origin --get-regexp '^credential\.'
```

This command will list all configurations starting with `credential.` and display which file the configuration comes from before each line. No output means there is no explicit configuration of this type currently. If the value of `credential.helper` is `store`, credentials will be saved in plaintext on disk long-term, and this should not be used as the regular storage method for access tokens.

### Commit Signatures and GitHub `Verified`

Commit signing is an optional feature used to prove that a commit was signed by the corresponding private key. If you only need to differentiate between commit identity and remote account, you can skip this section; the following uses GitHub's `Verified` badge as a specific scenario, using SSH signatures supported by Git 2.34 and above.

#### One-Time Configuration

First, generate a key dedicated to personal commit signing and add the private key to `ssh-agent`:

```bash
ssh-keygen -t ed25519 -C "personal@example.com" \
  -f ~/.ssh/id_ed25519_signing_personal
ssh-add ~/.ssh/id_ed25519_signing_personal
```

Then register the public key as the signing key for the correct GitHub account. When already logged in to `gh`, you can upload it directly; in a multi-account environment, check the active account first:

```bash
gh auth status --active --hostname github.com
# Execute only if the active account is not personal-user
gh auth switch --hostname github.com --user personal-user
gh ssh-key add ~/.ssh/id_ed25519_signing_personal.pub \
  --type signing \
  --title "Personal signing key"
```

You can also choose **Signing Key** under **Settings → SSH and GPG keys → New SSH key** on GitHub, then paste the contents of `id_ed25519_signing_personal.pub`. Uploading the public key only allows GitHub to verify the signature; you still need to tell the local Git which key to use.

Write the signature settings into the personal identity file `personal.inc` loaded earlier via `includeIf`:

```ini
[user]
    name = Example User
    email = personal@example.com
    signingKey = /home/example/.ssh/id_ed25519_signing_personal.pub

[gpg]
    format = ssh

[commit]
    gpgSign = true
```

`signingKey` points to the public key file, and during signing, `ssh-agent` provides the corresponding private key. `commit.gpgSign = true` makes new commits created with this identity include signatures by default; if you only want to sign individual commits, you can delete this item and execute `git commit -S` when needed.

#### Daily Use

Once configuration is complete, normal commits will be automatically signed:

```bash
git commit -m "Signed commit"
git push
```

After GitHub receives the commit, it will use the signing key registered to the account to verify the signature and display `Verified`. This result does not depend on whether SSH or HTTPS was used for pushing; under whose contribution graph the commit appears is still determined by the association between the commit email and the GitHub account.

#### Optional: Local Verification

GitHub's `Verified` is platform-side verification. To run `git verify-commit` locally, you also need to maintain an allowed signers file, such as `~/.config/git/allowed_signers`:

```text
personal@example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
```

Then configure its path:

```ini
[gpg "ssh"]
    allowedSignersFile = /home/example/.config/git/allowed_signers
```

Afterward, you can verify locally:

```bash
git verify-commit HEAD
```

The allowed signers file only dictates which public keys this computer trusts; it will not be uploaded to GitHub and does not affect GitHub's `Verified`. When the work identity requires an independent signature, configure another signing key in `work.inc` and register the corresponding public key to the work account.

## Configuration Boundaries and Verification

Whether directory rules take effect should be based on Git's actual configuration results. After moving a repository or creating a linked worktree, you can re-run `git config --show-origin --get user.email` to confirm that the current identity comes from the expected file.

Identity configuration only affects subsequently created commits. Moving repositories, modifying `user.email`, or changing SSH keys will not rewrite existing commits; the author, committer, and signature in existing commits belong to the commit object itself. If a commit is recreated via operations like rebase, the committer information and signature of the new commit may change according to the current configuration.

Correct content in configuration files does not mean the value ultimately used by the current repository is correct. Repository local configurations, command-line `-c` parameters, or environment variables might all alter the result. The following commands check each layer respectively:

| Content to Verify | Command |
| --- | --- |
| Final value, source, and scope of all configurations | `git config --list --show-origin --show-scope` |
| Identity Git will write to new commits | `git var GIT_AUTHOR_IDENT`, `git var GIT_COMMITTER_IDENT` |
| Current remote address | `git remote get-url origin` |
| Accounts saved by `gh` and current active account | `gh auth status --hostname github.com` |
| `gh`'s currently preferred Git transport protocol | `gh config get git_protocol --host github.com` |
| GitHub HTTPS credential helper and its config source | `git config --show-origin --get-all credential.https://github.com.helper` |
| Connection configuration ultimately used by SSH alias | `ssh -G github-work` |
| SSH account actually recognized by GitHub | `ssh -T github-work` |
| Identity and signature recorded in existing commits | `git show --no-patch --format=fuller --show-signature HEAD` |

Common mismatches should be pinpointed by the specific chain where the problem actually occurs:

| Phenomenon | Check Location |
| --- | --- |
| Commit email wrong, but push account correct | Does `includeIf` match, and does local config override identity file? |
| Commit email correct, but push account wrong | Remote URL, SSH host alias, `gh` active account, or HTTPS credential record |
| `gh` command uses wrong account, but SSH push account is correct | `gh auth status`; SSH keys won't choose API accounts for `gh` |
| After `gh auth switch`, Git HTTPS still uses old account | Is `gh` actually the credential helper for `github.com`? |
| SSH alias test correct, but Git uses another key | Does `origin` actually use the corresponding alias instead of `github.com`? |
| Cannot create commit in new repository | Does the repository match an identity file? Did `user.useConfigOnly` block identity guessing? |
| Signed successfully, but platform doesn't show as verified | Account signing public key is registered to, commit email, and platform verification rules |

A set of multi-identity configurations that can be maintained long-term does not rely on a vague "current account": repository configurations dictate who is recorded in the commit, remote URLs and credential mechanisms dictate whose privileges `git push` executes with, `gh`'s active account dictates who the GitHub CLI calls the API on behalf of, and signature configurations dictate which key is used to sign the commit. The four chains can be queried separately, so that expected results can continue to be obtained after adding accounts, platforms, or signature strategies.

## Reference Documentation

- [Git Configuration Scopes and Conditional Includes](https://git-scm.com/docs/git-config)
- [Git HTTPS Credentials](https://git-scm.com/docs/gitcredentials)
- [`ghq` Official Documentation](https://github.com/x-motemen/ghq)
- [OpenSSH Client Configuration](https://man.openbsd.org/ssh_config)
- [GitHub CLI Login](https://cli.github.com/manual/gh_auth_login)
- [Configure GitHub CLI as a Git Credential Helper](https://cli.github.com/manual/gh_auth_setup-git)
- [GitHub CLI Multi-Account Switching](https://cli.github.com/manual/gh_auth_switch)
- [GitHub CLI Multi-Account Design Notes](https://github.com/cli/cli/blob/trunk/docs/multiple-accounts.md)
- [Recommended Management of GitHub HTTPS Credentials](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git)
- [GitHub Multi-Account Management](https://docs.github.com/en/account-and-profile/how-tos/account-management/managing-multiple-accounts)
- [Git Credential Manager Multi-Account Configuration](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/multiple-users.md)
- [Gitee HTTPS Credential Issue Explanation](https://gitee.com/help/articles/4298)
- [Adding a New SSH Key to Your GitHub Account](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account)
- [GitHub Commit Signature Verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
