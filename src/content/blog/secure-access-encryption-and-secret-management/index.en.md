---
title: Secure Access, Encryption, and Secret Management
description: An introduction to SSH public-key authentication, age file encryption, and SOPS structured-secret management, including common operations and methods for converting and verifying SSH keys and age identities.
---

## SSH

SSH is a secure remote-access protocol. Its most common public-key authentication method uses a key pair: the public key can be distributed, while the private key must remain under the holder's control.

### Generating a key

Generate an Ed25519 key pair:

```bash
# -t selects the key type
# -C adds an optional label for identifying the key; it does not participate in key generation or authentication
# Accepting the default path creates ~/.ssh/id_ed25519 (private key) and ~/.ssh/id_ed25519.pub (public key)
ssh-keygen -t ed25519 -C "name@example.com"
```

### Installing a public key

If the remote server permits password login, install the public key with `ssh-copy-id`:

```bash
# -i selects the public-key file to install
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@example.com
```

`ssh-copy-id` usually registers the public key in the remote account's `~/.ssh/authorized_keys`. This does not grant login capability to the public key itself; it tells the server to trust a matching private key. The client signs authentication data for the current session with the private key, and the server verifies that signature with the public key. Producing a valid signature proves that the client holds the corresponding private key. The private key never needs to be transmitted.

### Inspecting and verifying keys

GitHub displays the SHA-256 fingerprint of every registered public key on its SSH keys page. Run the following command and compare the two `SHA256:...` values. If they match, the key registered with GitHub is this local public key:

```bash
# -l displays the public-key fingerprint; -f selects the key file
ssh-keygen -lf ~/.ssh/id_ed25519.pub
```

Derive the public key again from the private key:

```bash
# -y reads a private key and outputs its public key; -f selects the private-key file
ssh-keygen -y -f ~/.ssh/id_ed25519
```

This can verify whether a private key corresponds to a particular public key. The derived output usually omits the comment at the end of the original public-key line, so compare the key type and Base64-encoded value rather than requiring the complete lines to be identical.

### Using `ssh-agent`

`ssh-agent` can retain unlocked private keys for the current login session so that their passphrases do not need to be entered for every connection. Many desktop environments start an agent automatically. If the current environment does not, start one manually and add a key:

```bash
# -s prints environment-variable commands suitable for a Bourne shell
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

List keys currently loaded in the agent:

```bash
# -l lists fingerprints of keys held by the agent
ssh-add -l
```

Remove a particular key from the agent:

```bash
# -d removes the specified private key from the agent
ssh-add -d ~/.ssh/id_ed25519
```

### Using SSH configuration

When connecting to the same host frequently, save its hostname, username, and key path in `~/.ssh/config`:

```sshconfig
Host example
  HostName example.com
  User user
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes # Restrict the client to the explicitly selected identity instead of trying many keys loaded in the agent.
```

The connection then requires only:

```bash
ssh example
```

See [`sshd(8)`](https://man.openbsd.org/sshd) and [`ssh_config(5)`](https://man.openbsd.org/ssh_config) for the complete OpenSSH descriptions of public-key formats, `authorized_keys`, and file permissions.

## age

age is a file-encryption tool. It calls an encryption target a **recipient** and a decryption credential an **identity**. A recipient can be public, while an identity must remain secret.

### Generating an age identity

Generate a native age key pair:

```bash
mkdir -p ~/.config/sops/age
# -o selects the identity output file
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

The command writes the identity to `keys.txt` and prints its corresponding `age1` recipient in the terminal. Use the recipient to encrypt files. If it is needed again later, derive it from the identity:

```bash
# -y outputs the recipient corresponding to an identity
age-keygen -y ~/.config/sops/age/keys.txt
```

The same identity always produces the same recipient. The path `~/.config/sops/age/keys.txt` is used here because it is also the default location where SOPS looks for age identities on Linux.

### Encrypting and decrypting files

Encrypt a file for a recipient:

```bash
# -r selects a recipient; -o selects the encrypted output path
age -r age1example... -o document.txt.age document.txt
```

Decrypt it with an identity:

```bash
# --decrypt selects decryption mode; -i selects the identity; -o selects the plaintext output path
age --decrypt \
  -i ~/.config/sops/age/keys.txt \
  -o document.txt \
  document.txt.age
```

Repeat `-r` to add multiple recipients to the same file:

```bash
# Each -r adds one recipient; -o selects the encrypted output path
age \
  -r age1alice... \
  -r age1bob... \
  -o document.txt.age \
  document.txt
```

Any one of the corresponding identities can independently decrypt the file.

### Encrypting with a passphrase

When a key pair is unnecessary, age can use a passphrase instead:

```bash
# --passphrase encrypts with a passphrase rather than a recipient; -o selects the output path
age --passphrase -o document.txt.age document.txt
# --decrypt selects decryption mode; -o selects the plaintext output path
age --decrypt -o document.txt document.txt.age
```

age reads the passphrase interactively from the terminal during encryption and decryption. It does not appear as a command-line argument.

### Using SSH keys directly

age natively supports RSA and Ed25519 SSH public keys. A file can be encrypted directly with an SSH public-key file and decrypted with the corresponding private key:

```bash
# -R reads recipients from a file; -o selects the encrypted output path
age -R ~/.ssh/id_ed25519.pub -o document.txt.age document.txt
# --decrypt selects decryption mode; -i selects the SSH private key; -o selects the plaintext output path
age --decrypt -i ~/.ssh/id_ed25519 -o document.txt document.txt.age
```

GitHub publicly exposes the SSH keys added to a user account. Download the list and use it as a recipients file:

```bash
# -f fails on HTTP errors, -s suppresses normal output, -S still shows errors, -L follows redirects, and -o selects the output file
curl -fsSL https://github.com/<username>.keys -o recipients.txt
# -R reads recipients from a file; -o selects the encrypted output path
age -R recipients.txt -o document.txt.age document.txt
```

Inspect the returned keys and their fingerprints before use rather than feeding an unverified remote response directly into long-lived encryption. SSH keys associated with a GitHub account may also be replaced or removed later.

age defines SSH recipients as a convenient compatibility mechanism for existing SSH keys. When file-encryption keys can be managed independently, prefer a native age identity. See the [SSH keys](https://github.com/FiloSottile/age/blob/main/doc/age.1.ronn#ssh-keys) section of the age manual for supported SSH recipient types and limitations.

### `ssh-to-age`

`ssh-to-age` deterministically derives native age keys from Ed25519 SSH keys. It is useful when a downstream tool accepts only an `age1...` recipient but the available input is an Ed25519 SSH key.

Derive an age recipient from an SSH public key:

```bash
# -i selects the SSH public-key file to convert
ssh-to-age -i ~/.ssh/id_ed25519.pub
```

Derive an age identity from an SSH private key:

```bash
# -private-key marks the input as an SSH private key; -i selects the input and -o the age identity output
ssh-to-age \
  -private-key \
  -i ~/.ssh/id_ed25519 \
  -o derived-age-identity.txt
```

Compare the recipients derived from the SSH public key and the age identity:

```bash
# The two -i arguments select the SSH public key to convert and the age identity to read
ssh-to-age -i ~/.ssh/id_ed25519.pub
age-keygen -y derived-age-identity.txt
```

The two commands should output the same `age1...` recipient.

To verify further that an existing age identity is exactly the result of converting a particular SSH private key, convert the private key again and compare the identities directly:

```bash
# -private-key converts the SSH private key and -i selects the input; cmp -s returns only a status and does not print identity contents
cmp -s \
  <(ssh-to-age -private-key -i ~/.ssh/id_ed25519) \
  derived-age-identity.txt
echo $?
```

Exit status `0` means the contents are identical, `1` means they differ, and a value greater than `1` means the comparison itself failed.

`ssh-to-age` converts only Ed25519 keys, not RSA keys. The derived age identity independently permits decryption. If it is stored unencrypted on disk, reading that file no longer requires the original SSH private-key passphrase. See `ssh-to-age`'s [Security considerations](https://github.com/Mic92/ssh-to-age#security-considerations) for the underlying mechanism and risks.

## SOPS

SOPS is an encrypted-file editor. It supports YAML, JSON, dotenv, INI, and binary files, and can protect file keys through age, PGP, cloud KMS products, and other mechanisms.

For YAML, JSON, dotenv, and INI, SOPS preserves field names and structure by default and encrypts only leaf values. This keeps structural changes visible in Git without exposing the values themselves. Field names remain visible, so sensitive information must not be placed in field names.

### Configuring recipients

Create `.sops.yaml` in the repository root:

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.ya?ml$
    age:
      - age1example...
```

SOPS searches upward from the current working directory for `.sops.yaml` and uses the first `creation_rules` entry that matches the target path. The file must be named `.sops.yaml`; `.sops.yml` is not discovered automatically.

Multiple recipients can be listed:

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.ya?ml$
    age:
      - age1alice...
      - age1bob...
```

By default, any one of their corresponding identities can decrypt the file.

SOPS also accepts `ssh-ed25519` and `ssh-rsa` public keys as age recipients:

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.ya?ml$
    age:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
```

### Creating and editing files

Create a file directly through SOPS:

```bash
# Pass the path directly; SOPS creates the file and writes ciphertext when it is saved
sops secrets/application.sops.yaml
```

SOPS opens an editor. After it is saved and closed, the file written to disk is encrypted.

Use the same command to edit an existing encrypted file:

```bash
# Pass the encrypted path directly; SOPS presents a plaintext editing view and re-encrypts on save
sops secrets/application.sops.yaml
```

SOPS provides a plaintext view while editing and re-encrypts the file when it is saved.

If a plaintext file already exists, encrypt it in place:

```bash
# encrypt performs encryption; --in-place replaces the input file
sops encrypt --in-place secrets/application.yaml
```

Before doing so, verify that the plaintext was not committed to Git history.

### Decrypting files

Print plaintext to the terminal:

```bash
# decrypt decrypts the file and writes plaintext to standard output
sops decrypt secrets/application.sops.yaml
```

Write it to a file:

```bash
# > redirects standard output to the specified file
sops decrypt secrets/application.sops.yaml > application.yaml
```

The second form creates a plaintext file on disk. Handle it appropriately for the actual environment after use.

### Selecting an age identity

By default, SOPS looks for `sops/age/keys.txt` under the user's configuration directory. `SOPS_AGE_KEY_FILE` can select an identity file explicitly:

```bash
# SOPS_AGE_KEY_FILE selects a native age identity file for this command
SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt" \
  sops decrypt secrets/application.sops.yaml
```

The selected file must contain an age identity, not an `age1...` recipient.

When using an SSH recipient, select the SSH private key explicitly:

```bash
# SOPS_AGE_SSH_PRIVATE_KEY_FILE selects the SSH private key used for age decryption in this command
SOPS_AGE_SSH_PRIVATE_KEY_FILE="$HOME/.ssh/id_ed25519" \
  sops decrypt secrets/application.sops.yaml
```

`SOPS_AGE_KEY_FILE` and `SOPS_AGE_SSH_PRIVATE_KEY_FILE` refer respectively to a native age identity and an SSH private key and must not be interchanged.

### Updating recipients

SOPS does not use an age recipient to encrypt every configuration value directly. It generates a random symmetric key for each file and uses that key to encrypt the file contents. This SOPS-managed internal key is called the **data key**. SOPS then encrypts the data key separately for every recipient and stores those encrypted copies in the file's `sops` metadata. During decryption, an identity first decrypts the data key, and the data key then decrypts the file contents.

The data key is neither an age identity nor a recipient, and it is not one of the secrets—such as passwords or tokens—stored in the file. Users do not generate or preserve it separately.

Changing `.sops.yaml` does not update existing ciphertext automatically. After adding or removing a recipient, use `updatekeys` to synchronize recipient information in the file:

```bash
# updatekeys updates the file's recipient key metadata according to the current configuration
sops updatekeys secrets/application.sops.yaml
```

`updatekeys` changes neither the file contents nor its data key. It only reevaluates which recipients can decrypt that data key under the current configuration. When only adding a recipient, this step is usually sufficient.

If the removed recipient is compromised or no longer trusted, also make the current file use a newly generated data key:

```bash
# rotate generates a new data key; --in-place updates the file in place
sops rotate --in-place secrets/application.sops.yaml
```

`rotate` makes SOPS generate a new data key and re-encrypt all current values with it. It does not replace age identities or change plaintext passwords, tokens, or other secrets. If an untrusted identity previously had permission to read the file, rotate those actual passwords and tokens as appropriate. See SOPS [Key management](https://getsops.io/docs/usage/key-management/) for the complete procedure.

### Common problems

- **No creation rule is found**: verify that the configuration is named `.sops.yaml` and run the command from that directory or one of its descendants.
- **The wrong parser is used**: SOPS usually infers YAML, JSON, dotenv, or binary format from the extension. Renaming a file may require explicit input and output types.
- **A new recipient cannot decrypt an old file**: after changing `.sops.yaml`, run `sops updatekeys` on existing files.
- **A public key was selected but decryption fails**: a recipient only encrypts; decryption requires the corresponding age identity or SSH private key.
- **The structure was expected to be hidden**: structured SOPS formats preserve field names and hierarchy by default. To hide the entire file, treat it as binary data or use age directly.

## How the three tools work together

A common division of responsibilities is:

- SSH keys authenticate server logins and access to Git services.
- age encrypts ordinary files and can directly reuse existing RSA or Ed25519 SSH public keys.
- SOPS uses age recipients to manage secret configuration whose structure and Git diffs should remain visible.
- `ssh-to-age` is needed only when an Ed25519 SSH key must be converted to the native age format.

## References

1. [OpenSSH manual pages](https://www.openssh.com/manual.html)
2. [age documentation](https://github.com/FiloSottile/age/tree/main/doc)
3. [SOPS documentation](https://getsops.io/docs/)
4. [`ssh-to-age` documentation](https://github.com/Mic92/ssh-to-age)
