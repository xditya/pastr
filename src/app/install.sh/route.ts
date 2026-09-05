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
# pastly installer — puts the \`pastly\` shell CLI in ~/.local/bin (override with PASTLY_BIN_DIR).
set -eu
DIR="\${PASTLY_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$DIR"
curl -fsSL "${origin}/pastly.sh" -o "$DIR/pastly"
chmod +x "$DIR/pastly"
echo "installed $DIR/pastly (host: ${origin})"
case ":$PATH:" in
  *":$DIR:"*) ;;
  *) echo "add it to your PATH:  export PATH=\\"$DIR:\\$PATH\\"" ;;
esac
echo "try:  echo hello | pastly"
`;
  return text(script, { headers: { "Cache-Control": "public, max-age=300", "Content-Type": "text/x-shellscript; charset=utf-8" } });
}
