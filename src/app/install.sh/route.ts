import { originFrom } from "@/lib/url";
import { text } from "@/lib/http";

export const runtime = "nodejs";

/**
 * `curl -fsSL https://host/install.sh | sh` — installs the shell CLI into ~/.local/bin
 * with this instance's URL baked in as the default host.
 */
export async function GET(req: Request) {
  const origin = originFrom(req);
  const script = `#!/bin/sh
# pastr installer — puts the \`pastr\` shell CLI in ~/.local/bin (override with PASTR_BIN_DIR).
set -eu
DIR="\${PASTR_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$DIR"
curl -fsSL "${origin}/pastr.sh" -o "$DIR/pastr"
chmod +x "$DIR/pastr"
echo "installed $DIR/pastr (host: ${origin})"
case ":$PATH:" in
  *":$DIR:"*) ;;
  *) echo "add it to your PATH:  export PATH=\\"$DIR:\\$PATH\\"" ;;
esac
echo "try:  echo hello | pastr"
`;
  return text(script, { headers: { "Cache-Control": "public, max-age=300", "Content-Type": "text/x-shellscript; charset=utf-8" } });
}
