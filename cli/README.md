# paster-cli

Paste from the terminal to any [paster](https://github.com/xditya/paster) instance.

```sh
npm install -g paster-cli        # or: npx paster-cli …
paster config host https://your-paster.example

ls -la | paster                  # stdin → link
paster main.go --expires 1d      # file (language from the extension)
paster clip -E -c                # clipboard, encrypted in the terminal, link copied back
paster text "hello there" -b     # literal text, burn after read
paster get https://host/AbCd1234#key
paster ls                        # what you pasted from this machine
paster rm AbCd1234               # delete (uses the locally stored edit token)
```

- Zero dependencies, Node 20+, macOS/Linux/Windows/WSL.
- `-E` encrypts with AES-256-GCM before upload; the key is only in the URL fragment. `-p`/`-P` uses a password instead.
- Edit tokens and link keys are kept in `~/.config/paster/history.json` (`%APPDATA%\paster` on Windows), mode 0600.
- Set the host once with `paster config host …` or `PASTER_HOST`.

Prefer no Node at all? Every paster instance serves a tiny POSIX shell version: `curl -fsSL https://your-paster.example/install.sh | sh`.
