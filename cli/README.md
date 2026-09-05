# pastr

Paste from the terminal to any [pastr](https://github.com/xditya/pastr) instance, such as [pastr.xditya.me](https://pastr.xditya.me).

```sh
npm install -g @xditya/pastr        # or: npx @xditya/pastr …
pastr config host https://your-pastr.example   # optional, defaults to pastr.xditya.me

ls -la | pastr                  # stdin → link
pastr main.go --expires 1d      # file (language from the extension)
pastr clip -E -c                # clipboard, encrypted in the terminal, link copied back
pastr shot.png                  # images (png/jpeg/gif/webp, up to 700 KB); clip also takes a copied image
pastr text "hello there" -b     # literal text, burn after read
pastr get https://host/AbCd1234#key
pastr ls                        # browse what you pasted here: ↑↓ or click a row, enter reveals the edit token, again copies it
pastr rm AbCd1234               # delete (uses the locally stored edit token)
pastr token AbCd1234            # show that token, for the site's Edit/Delete prompt
```

- Zero dependencies, Node 20+, macOS/Linux/Windows/WSL.
- `-E` encrypts with AES-256-GCM before upload; the key is only in the URL fragment. `-p`/`-P` uses a password instead.
- Edit tokens and link keys are kept in `~/.config/pastr/history.json` (`%APPDATA%\pastr` on Windows), mode 0600.
- Talks to pastr.xditya.me unless you point it elsewhere with `pastr config host …`, `PASTR_HOST` or `-H`.

Prefer no Node at all? Every pastr instance serves a tiny POSIX shell version: `curl -fsSL https://your-pastr.example/install.sh | sh`.
