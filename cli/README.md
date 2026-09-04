# pastly

Paste from the terminal to any [pastly](https://github.com/xditya/paster) instance.

```sh
npm install -g pastly        # or: npx pastly …
pastly config host https://your-pastly.example

ls -la | pastly                  # stdin → link
pastly main.go --expires 1d      # file (language from the extension)
pastly clip -E -c                # clipboard, encrypted in the terminal, link copied back
pastly text "hello there" -b     # literal text, burn after read
pastly get https://host/AbCd1234#key
pastly ls                        # what you pasted from this machine
pastly rm AbCd1234               # delete (uses the locally stored edit token)
```

- Zero dependencies, Node 20+, macOS/Linux/Windows/WSL.
- `-E` encrypts with AES-256-GCM before upload; the key is only in the URL fragment. `-p`/`-P` uses a password instead.
- Edit tokens and link keys are kept in `~/.config/pastly/history.json` (`%APPDATA%\pastly` on Windows), mode 0600.
- Set the host once with `pastly config host …` or `PASTER_HOST`.

Prefer no Node at all? Every pastly instance serves a tiny POSIX shell version: `curl -fsSL https://your-pastly.example/install.sh | sh`.
