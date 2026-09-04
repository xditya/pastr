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
check "$(curl -si "$BASE/$ID.go/raw?dl=1" | grep -i content-disposition | tr -d '\r' | tr 'A-Z' 'a-z')" 'content-disposition: attachment; filename="main.go"' "raw download filename"
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
check "$(curl -s $BASE/nope1234/raw)" "error: this paste doesn't exist, expired, or was burned" "raw 404 text"
check "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $BASE/api/v1/pastes)" "204" "cors preflight"
check "$(curl -s $BASE/api/v1/info | py 'd["name"]+"|"+d["storage"]+"|"+str(len(d["languages"])>50)')" "paster|memory|True" "info"
echo "passed=$pass failed=$fail"
[ $fail -eq 0 ]
