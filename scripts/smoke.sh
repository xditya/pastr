#!/usr/bin/env bash
# End-to-end API smoke test against a running server on $BASE (memory store, rate limit disabled).
set -u
BASE=${BASE:-http://localhost:3111}
J='content-type: application/json'
A='accept: application/json'
pass=0; fail=0
check() { if [ "$1" == "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $3 — expected [$2] got [$1]"; fi; }
py() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

R=$(curl -s -H "$J" -d '{"content":"package main\nfunc main(){}","lang":"go","title":"main.go","expires":"1h"}' $BASE/api/v1/pastes)
ID=$(echo "$R" | py 'd["id"]'); TOK=$(echo "$R" | py 'd["editToken"]')
check "$(echo "$R" | py 'd["lang"]+"|"+d["title"]+"|"+str(d["views"])+"|"+str("editHash" in d)')" "go|main.go|0|False" "create json shape"
check "$(echo "$R" | py 'd["url"].endswith("/"+d["id"]+".go")')" "True" "url has lang suffix"

check "$(curl -s --data-binary 'hello raw' "$BASE/api/v1/pastes?name=notes.md&expires=10m" | grep -c "^$BASE/[A-Za-z0-9]*\.markdown$")" "1" "raw curl body → plain url"
check "$(curl -s -H "$A" --data-binary 'hello raw' "$BASE/api/v1/pastes?lang=py" | py 'd["lang"]')" "python" "raw body + ?lang"
check "$(curl -s -H "$A" -d 'content=form+text&lang=rs' $BASE/api/v1/pastes | py 'd["lang"]+"|"+d["content"]')" "rust|form text" "urlencoded form"
printf 'print(1)\n' > /tmp/smoke_t.py
check "$(curl -s -H "$A" -F 'content=@/tmp/smoke_t.py' $BASE/api/v1/pastes | py 'd["lang"]+"|"+d["title"]')" "python|smoke_t.py" "multipart file → lang+title"
check "$(curl -s -H "$A" -H "$J" -d '{"content":"x","title":"'"$(printf 'a%.0s' {1..130})"'"}' $BASE/api/v1/pastes | py 'd["error"]["code"]')" "invalid" "title too long"

check "$(curl -s $BASE/api/v1/pastes/$ID | py 'str(d["views"])+"|"+d["lang"]')" "1|go" "read counts view"
check "$(curl -s $BASE/api/v1/pastes/$ID | py 'str(d["views"])')" "2" "second read"
check "$(curl -s $BASE/$ID/raw)" "package main
func main(){}" "raw body"
check "$(curl -si "$BASE/$ID.go/raw?dl=1" | grep -i content-disposition | tr -d '\r' | tr 'A-Z' 'a-z')" "content-disposition: attachment; filename=\"main.go\"; filename*=utf-8''main.go" "raw download filename"
check "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$J" -d '{"title":"x"}' $BASE/api/v1/pastes/$ID)" "401" "patch without token"
check "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "authorization: Bearer nope" -H "$J" -d '{"title":"x"}' $BASE/api/v1/pastes/$ID)" "403" "patch bad token"
check "$(curl -s -X PATCH -H "authorization: Bearer $TOK" -H "$J" -d '{"title":"renamed.go","content":"package x"}' $BASE/api/v1/pastes/$ID | py 'd["title"]+"|"+d["content"]+"|"+str(d["views"])')" "renamed.go|package x|4" "patch ok keeps views (raw reads count too)"
check "$(curl -s -X PATCH -H "authorization: Bearer $TOK" -H "$J" -d '{}' $BASE/api/v1/pastes/$ID | py 'd["error"]["code"]')" "invalid" "patch empty"
check "$(curl -s -H "$J" -d '{"reason":"spam spam"}' $BASE/api/v1/pastes/$ID/report | py 'str(d["ok"])+"|"+str(d["count"])')" "True|1" "report"
check "$(curl -s -H "$J" -d '{"reason":"x"}' $BASE/api/v1/pastes/$ID/report | py 'd["error"]["code"]')" "invalid" "report short reason"

K=$(curl -s --data-binary 'haste me' $BASE/documents | py 'd["key"]')
check "$(curl -s $BASE/documents/$K | py 'd["data"]+"|"+d["key"]')" "haste me|$K" "hastebin create/read"
check "$(curl -s $BASE/raw/$K)" "haste me" "hastebin raw"

B=$(curl -s -H "$A" -H "$J" -d '{"content":"once","burn":true}' $BASE/api/v1/pastes | py 'd["id"]')
check "$(curl -s $BASE/api/v1/pastes/$B | py 'd["content"]+"|"+str(d["burn"])')" "once|True" "burn first read"
check "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/pastes/$B)" "404" "burn second read gone"

E=$(curl -s -H "$A" -H "$J" -d '{"content":"Y2lwaGVy","title":"leak","lang":"go","enc":{"alg":"AES-GCM","kdf":"fragment","iv":"AAAAAAAAAAAAAAAA"}}' $BASE/api/v1/pastes)
check "$(echo "$E" | py 'str(d.get("title"))+"|"+d["lang"]+"|"+d["enc"]["kdf"]')" "None|text|fragment" "encrypted scrubs title/lang"
EID=$(echo "$E" | py 'd["id"]')
check "$(curl -si $BASE/$EID/raw | grep -i '^x-encrypted:' | tr -d '\r' | tr 'A-Z' 'a-z')" "x-encrypted: 1" "raw encrypted header"

check "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "authorization: Bearer $TOK" $BASE/api/v1/pastes/$ID)" "204" "delete"
check "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/pastes/$ID)" "404" "deleted gone"
check "$(curl -s -H "$A" -H "$J" -d '{"content":"   "}' $BASE/api/v1/pastes | py 'd["error"]["code"]')" "invalid" "empty content"
check "$(curl -s -H "$A" -H "$J" -d '{"content":"x","enc":{"alg":"AES-CBC"}}' $BASE/api/v1/pastes | py 'd["error"]["code"]')" "invalid" "bad enc"
check "$(curl -s -H "$A" -H "$J" -d '[1,2]' $BASE/api/v1/pastes | py 'd["error"]["code"]')" "bad_request" "json array body"
check "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/pastes/zzzzzzzz)" "404" "unknown id"
check "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/pastes/..%2f..")" "404" "weird id"
check "$(curl -s $BASE/nope1234/raw)" "error: this paste doesn't exist, expired, or was burned (not_found)" "raw 404 text"
check "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $BASE/api/v1/pastes)" "204" "cors preflight"
check "$(curl -s $BASE/api/v1/info | py 'd["name"]+"|"+d["storage"]+"|"+str(len(d["languages"])>50)')" "pastr|memory|True" "info"

# ---- review regressions ----
H=$(curl -s -H "$A" -H "$J" -d '{"content":"head me","burn":true}' $BASE/api/v1/pastes | py 'd["id"]')
check "$(curl -s -o /dev/null -w '%{http_code}' -I $BASE/$H/raw)" "200" "HEAD raw exists"
check "$(curl -s -o /dev/null -w '%{http_code}' -I $BASE/api/v1/pastes/$H)" "200" "HEAD api exists"
check "$(curl -s -o /dev/null -w '%{http_code}' -I $BASE/documents/$H)" "200" "HEAD documents exists"
check "$(curl -s $BASE/api/v1/pastes/$H | py 'd["content"]')" "head me" "HEAD did not burn"
check "$(curl -s -o /dev/null -w '%{http_code}' -I $BASE/api/v1/pastes/$H)" "404" "HEAD after burn is 404"
T=$(curl -s -H "$A" -H "$J" -d '{"content":"t","title":"has-title"}' $BASE/api/v1/pastes); TID=$(echo "$T" | py 'd["id"]'); TT=$(echo "$T" | py 'd["editToken"]')
check "$(curl -s -X PATCH -H "authorization: Bearer $TT" -H "$J" -d '{"title":""}' $BASE/api/v1/pastes/$TID | py 'str(d.get("title"))')" "None" "PATCH clears title"
check "$(curl -s -H "$A" $BASE/api/v1/pastes/$TID.txt | py 'd["id"]')" "$TID" "API accepts .lang suffix"
check "$(head -c 1600000 /dev/zero | tr '\0' 'a' | curl -s -o /dev/null -w '%{http_code}' -H "$A" -H 'content-type: text/plain' --data-binary @- $BASE/api/v1/pastes)" "413" "1.5 MiB → 413"
check "$(curl -s -H "$A" -H "$J" -d '{"content":"x","burn":"maybe"}' $BASE/api/v1/pastes | py 'd["error"]["code"]')" "invalid" "unknown burn value rejected"
check "$(curl -s -H "$A" --data-binary 'x' "$BASE/api/v1/pastes?burn" | py 'str(d["burn"])')" "True" "bare ?burn means true"
FB=$(printf 'data=a+b%%41\nline2' | curl -s -H "$A" --data-binary @- $BASE/api/v1/pastes | py 'd["content"]'); check "$FB" "data=a+b%41
line2" "multi-line body is not url-decoded"
check "$(curl -s -H "$A" -F 'file=@/tmp/smoke_t.py' $BASE/api/v1/pastes | py 'd["lang"]+"|"+d["title"]')" "python|smoke_t.py" "multipart file= alias"
check "$(printf 'x' | curl -s -H "$A" -F 'content=@-' $BASE/api/v1/pastes | py 'str(d.get("title"))')" "None" "stdin multipart has no '-' title"
check "$(curl -s -H "$A" -H "$J" -d '{"content":"q"}' "$BASE/api/v1/pastes?expires=10m" | py 'str(d["expires"] - d["created"])')" "600000" "query options apply to JSON bodies"
check "$(curl -s -H "$A" --data-binary 'p' "$BASE/api/v1/pastes?name=/home/me/src/main.go" | py 'd["title"]+"|"+d["lang"]')" "main.go|go" "name= is basenamed"
UF=$(curl -s -H "$A" -H "$J" -d '{"content":"ü","title":"résumé.md"}' $BASE/api/v1/pastes | py 'd["id"]'); check "$(curl -si "$BASE/$UF/raw?dl=1" | grep -i content-disposition | tr -d '\r' | grep -c "filename\*=UTF-8''r%C3%A9sum%C3%A9.md")" "1" "utf-8 download filename"
check "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H 'content-type: application/json' -d '{}' -H 'user-agent: curl/8' $BASE/api/v1/pastes/$TID)" "401" "text-mode error status"

check "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/admin/pastes)" "404" "admin API hidden without ADMIN_TOKEN"
check "$(curl -s "$BASE/?text=shared+text&title=From+share" | grep -c 'shared text')" "1" "share-target prefill renders"
check "$(curl -s $BASE/api/v1/info | py 'str(len(d["expiries"]))+"|"+d["defaultExpiry"]')" "6|7d" "info lists expiries"

# ---- CLI (Node) against the same server ----
export PASTR_CONFIG_DIR=$(mktemp -d)
CLI="node $(dirname "$0")/../cli/pastr.mjs"
check "$($CLI config host $BASE)" "host set to $BASE" "cli config host"
U=$(printf 'from stdin\n' | $CLI); check "$(echo "$U" | grep -c "^$BASE/[A-Za-z0-9]\{8\}$")" "1" "cli stdin → url"
check "$(curl -s "$U/raw")" "from stdin" "cli stdin content"
printf 'package main\n' > /tmp/smoke_cli.go
U2=$($CLI /tmp/smoke_cli.go -e 1h); check "$(echo "$U2" | grep -c '\.go$')" "1" "cli file → lang suffix"
check "$(curl -s -H "$A" $BASE/api/v1/pastes/$(basename "$U2" .go) | py 'd["title"]+"|"+d["lang"]')" "smoke_cli.go|go" "cli file title/lang"
U3=$($CLI text hello there -b); check "$(curl -s -H "$A" $BASE/api/v1/pastes/$(basename "$U3") | py 'd["content"]+"|"+str(d["burn"])')" "hello there|True" "cli text + burn"
U4=$(printf 'SECRET_CLI' | $CLI -E -t s.txt); check "$(echo "$U4" | grep -c '#[A-Za-z0-9_-]\{43\}$')" "1" "cli encrypt → fragment"
check "$(curl -s "$(echo "$U4" | cut -d'#' -f1)/raw" | grep -c SECRET_CLI)" "0" "cli encrypted raw is ciphertext"
check "$($CLI get "$U4")" "SECRET_CLI" "cli get decrypts with fragment"
U5=$(printf 'PW_CLI' | $CLI -p hunter2); check "$($CLI get "$U5" -p hunter2)" "PW_CLI" "cli password roundtrip"
check "$($CLI ls | grep -c "^[A-Za-z0-9]\{8\}")" "5" "cli ls lists 5"
check "$($CLI rm "$U")" "deleted $(basename "$U")" "cli rm"
check "$(curl -s -o /dev/null -w '%{http_code}' "$U/raw")" "404" "cli rm removed paste"
check "$($CLI get zzzzzzzz 2>&1 || true)" "pastr: 404 this paste doesn't exist, expired, or was burned" "cli get 404 message"
check "$($CLI --bogus >/dev/null 2>&1; echo $?)" "2" "cli unknown option exits 2"
# ---- shell CLI ----
SH=$(mktemp); curl -s "$BASE/pastr.sh" > "$SH"; chmod +x "$SH"
check "$(grep -c "HOST=\"\${PASTR_HOST:-$BASE}\"" "$SH")" "1" "pastr.sh has host baked in"
U6=$(printf 'from sh\n' | sh "$SH"); check "$(curl -s "$U6/raw")" "from sh" "sh stdin"
U7=$(sh "$SH" /tmp/smoke_cli.go -e 10m); check "$(echo "$U7" | grep -c '\.go$')" "1" "sh file → lang suffix"
check "$(sh "$SH" get "$U6")" "from sh" "sh get"
check "$(sh "$SH" get "$U6/raw")" "from sh" "sh get /raw url"
cp /tmp/smoke_cli.go "/tmp/my notes.go"; check "$(sh "$SH" /tmp/smoke_cli.go "/tmp/my notes.go" | grep -c '\.go$')" "2" "sh two files with a space"
check "$(sh "$SH" text hi there -b | grep -c "^$BASE/")" "1" "sh text"
check "$(curl -s "$BASE/install.sh" | grep -c "curl -fsSL \"$BASE/pastr.sh\"")" "1" "install.sh points at this host"
rm -rf "$PASTR_CONFIG_DIR" "$SH"
echo "passed=$pass failed=$fail"
[ $fail -eq 0 ]
