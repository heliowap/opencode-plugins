import { expect, test } from "bun:test"
import { flagsShellCommand } from "../src/shell-write.ts"

// Commands the former read-only allowlist denied in real sessions; none writes AGENTS.md.
test.each([
  "find . -name AGENTS.md -print",
  "git rev-parse HEAD && git status --short && find . -name AGENTS.md -print && sed -n '1,240p' calc.py && printf '\\n--- config/tax.yaml ---\\n' && cat config/tax.yaml",
  `sqlite3 -readonly ~/.local/share/opencode/opencode.db "select count(*) from session_message where data like '%AGENTS.md files are protected%'"`,
  "ls -la AGENTS.md",
  "git status --short; git merge --ff-only fb9b781a; cat backend/AGENTS.md; cat CODING_STANDARDS.md",
  `cd ~/VSCode/worktrees/opencode-v2-goal-plugin-log; grep -n "^## \\|mutation  \\|bun run mutation" README.md AGENTS.md | head -20`,
  "cd /repo/AllMedical-752-680-v2 && git status --short | head -50 && git diff --stat fb9b781a | tail -30 && wc -l CODING_STANDARDS.md backend/AGENTS.md",
  "sed -n 1,200p backend/AGENTS.md; echo ----; sed -n 1,200p frontend/AGENTS.md",
  "git show b3851c8f:backend/AGENTS.md | nl -ba",
  "cd /repo/AllMedical-issue-680 && cat backend/AGENTS.md | head -80",
  "ls -lt /tmp/opencode/ 2>/dev/null | head -30; find /tmp/ -name \"*.py\" -newer /repo/AGENTS.md 2>/dev/null | head -20",
  "find . -name AGENTS.md -not -path './node_modules/*' -not -path './.git/*'; git config --get branch.refactor/1845-template.remote",
  "cd ~/.config/opencode; git add AGENTS.md; git commit -m \"docs: point subagent model choices to the models tool\"; git log --oneline -1",
  "git diff HEAD origin/dev -- backend/AGENTS.md AGENTS.md backend/package.json | head -5",
  "rg -n 'lanes|sharded' AGENTS.md",
  "env cat AGENTS.md",
  "cat AGENTS.md > /tmp/agents-copy.md",
  "cat AGENTS.md 2>/dev/null || true",
  "diff AGENTS.md AGENTS.md.orig > /tmp/AGENTS.md.diff",
  "python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('AGENTS.md').read_text()[:200])\nPY",
  "python3 - <<'PY'\nfiles=['AGENTS.md','docs/DOCS-GUIDE.md']\nopen('/tmp/out.json','w').write(str(files))\nPY",
  "R=/repo; wc -c $R/AGENTS.md $R/README.md",
  "grep -o AGENTS.md notes.md",
  "sed -n '1,240p' /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/x/AGENTS.md",
  "python3 -c \"print(open('AGENTS.md').read().replace('a', 'b'))\"",
])("allows the read %j", (command) => {
  expect(flagsShellCommand(command)).toBe(false)
})

test.each([
  // Real writes from the same sessions.
  "set -u\nROOT=/tmp/shipping-pr1-base\nprintf '# Global rules\\n' > \"$ROOT/AGENTS.md\"",
  "cd /repo && T=$(mktemp -d) && cd $T && echo 'ver [x](docs/GLOSSARY/NOPE.md)' >> AGENTS.md && python3 scripts/check_doc_pointers.py",
  // Redirects and output options.
  "printf x >> AGENTS.md", "cat notes.md > AGENTS.md", "echo x >| AGENTS.md", "echo x 2> AGENTS.md", "echo x &> agents.md",
  "exec 3<> AGENTS.md", 'printf x > "folder with spaces/AGENTS.md"', "printf x >> ~/.config/opencode/AGENTS.md",
  "cat AGENTS.md && printf x >> AGENTS.md", "cat AGENTS.md\nprintf x >> AGENTS.md", "cat \"$(printf x >> 'AGENTS.md'; printf AGENTS.md)\"",
  "F=~/.config/opencode/AGENTS.md; printf x >> $F", 'F="dir/AGENTS.md"; printf x > "${F}"',
  "git diff --output=AGENTS.md", "git diff --no-index --output \"/d/AGENTS.md\" /dev/null notes.md", "cat AGENTS.md | sort -o AGENTS.md",
  "cat AGENTS.md | sort -oAGENTS.md", "cat AGENTS.md | sort --output=AGENTS.md",
  // Writer commands.
  "cat AGENTS.md | tee AGENTS.md", "tee -a AGENTS.md < notes.md", "mv notes.md AGENTS.md", "mv AGENTS.md /tmp/",
  "cp notes.md pkg/AGENTS.md", "cp AGENTS.md pkg/", "rm AGENTS.md", "rm -f ./AGENTS.md", "ln -sf notes.md AGENTS.md",
  "touch pkg/AGENTS.md", "truncate -s 0 AGENTS.md", "cat AGENTS.md | uniq - AGENTS.md", "find . -name AGENTS.md | xargs rm",
  "cat <(touch AGENTS.md)", "cat ~/$(touch AGENTS.md)", "sudo rm AGENTS.md", "cd repo && rm AGENTS.md",
  // In-place and scripted editors.
  "sed -i '' 's/a/b/' AGENTS.md", "cd /d && sed -i '' s/Global/X/ AGENTS.md", "sed -i.bak 1d AGENTS.md", "sed --in-place 1d AGENTS.md",
  "perl -pi -e 's/a/b/' AGENTS.md", "sed -n 'w AGENTS.md' notes.md", "sed -n '1w AGENTS.md' notes.md", "sed 's/a/b/w AGENTS.md' notes.md",
  "git checkout -- AGENTS.md", "git restore AGENTS.md", "git -C repo checkout HEAD -- AGENTS.md", "git rm AGENTS.md", "git mv AGENTS.md OLD.md",
  "find . -name AGENTS.md -delete", "find . -name AGENTS.md -exec sed -i '' 1d {} +",
  "python3 - <<'PY'\nfrom pathlib import Path\nPath('AGENTS.md').write_text('x')\nPY",
  "python3 -c \"open('AGENTS.md', 'a').write('x')\"", "node -e \"require('fs').writeFileSync('AGENTS.md', 'x')\"",
])("flags the write %j", (command) => {
  expect(flagsShellCommand(command)).toBe(true)
})

// Quoting-aware checks: a writer word or the AGENTS.md name inside a quoted argument of a
// non-writer does not count; only a writer's own arguments, a write API's path, or a local
// redirect target do.
test("a writer name inside a quoted grep pattern is not flagged", () => {
  expect(flagsShellCommand(`grep -n 'deploy\\|AGENTS.md\\|cp \\|cat ' .github/workflows/ci.yml`)).toBe(false)
  expect(flagsShellCommand("cp notes.md AGENTS.md")).toBe(true)
})

test("a script line that writes another file while mentioning AGENTS.md as data is not flagged", () => {
  const data =
    `python3 -c "import json,pathlib; (pathlib.Path('out')/'snapshot.json').write_text(json.dumps({'protected': 'Do not alter AGENTS.md/CLAUDE.md here'}))"`
  expect(flagsShellCommand(data)).toBe(false)
  expect(flagsShellCommand(`python3 -c "import pathlib; pathlib.Path('out/AGENTS.md').write_text('x')"`)).toBe(true)
})

test("a remote ssh command is not flagged", () => {
  expect(flagsShellCommand("ssh host 'cp -p ~/.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md.bak-$ts'")).toBe(false)
  expect(flagsShellCommand("ssh host cp -p ~/.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md.bak-$ts")).toBe(false)
  expect(flagsShellCommand("cp -p ~/.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md.bak")).toBe(true)
})

test("unparseable input falls back to the textual check", () => {
  expect(flagsShellCommand(`rm 'AGENTS.md`)).toBe(true)
  expect(flagsShellCommand(`cat 'AGENTS.md`)).toBe(false)
})

test("the time keyword's own options are skipped before the timed command", () => {
  expect(flagsShellCommand("time -p rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("time -p cat AGENTS.md")).toBe(false)
})

test("the -o operand of GNU time is a write target", () => {
  // The keyword and the binary both let "-o FILE" truncate and write FILE.
  expect(flagsShellCommand("time -o AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("time --output AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("env time -o AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("time -o out.txt rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("time -o out.txt cat notes.md")).toBe(false)
  expect(flagsShellCommand("time -f '%e' cat AGENTS.md")).toBe(false)
})

test("a clustered shell option containing c takes the next argument as a command", () => {
  expect(flagsShellCommand("bash -lc 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("zsh -fc 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("sh -ec 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("bash -lc 'cat AGENTS.md'")).toBe(false)
})

test("a command substitution inside arithmetic is still analyzed", () => {
  expect(flagsShellCommand("$(( $(rm AGENTS.md) + 1 ))")).toBe(true)
  expect(flagsShellCommand("$(( $(cat AGENTS.md) + 1 ))")).toBe(false)
})

test("a brace or parenthesis word mid-command is an argument, not a command split", () => {
  // "{", "}", "(" and ")" are shell syntax only in command position; as arguments of a
  // running command they are literal words (an xargs placeholder, a brace expansion).
  expect(flagsShellCommand("rm {} AGENTS.md")).toBe(true)
  expect(flagsShellCommand("rm {x} AGENTS.md")).toBe(true)
  expect(flagsShellCommand("rm {a,b}/AGENTS.md")).toBe(true)
  expect(flagsShellCommand("echo {} > AGENTS.md")).toBe(true)
  expect(flagsShellCommand("echo {} notes.md")).toBe(false)
  expect(flagsShellCommand("find . -exec sed -i '' 1d {} +")).toBe(false)
})

test("grouping braces and subshell parentheses still open a command position", () => {
  expect(flagsShellCommand("{ rm AGENTS.md; }")).toBe(true)
  expect(flagsShellCommand("( rm AGENTS.md )")).toBe(true)
  expect(flagsShellCommand("cd repo && { cat notes.md; }")).toBe(false)
})

test("a command-executing wrapper resolves the command it runs", () => {
  expect(flagsShellCommand("busybox rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("setsid rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("setsid -f rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("chroot /x rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("unshare rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("unshare -f rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("systemd-run rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("systemd-run --scope rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("nsenter -t 1 -m rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("flock /tmp/lock rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("flock /tmp/lock -c 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("taskset -c 0 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("taskset 0x3 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("firejail rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("busybox cat AGENTS.md")).toBe(false)
  expect(flagsShellCommand("setsid cat AGENTS.md")).toBe(false)
})

test("the demonstrated executors resolve the command they run", () => {
  expect(flagsShellCommand("parallel rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("parallel -j2 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("parallel rm ::: AGENTS.md")).toBe(true)
  expect(flagsShellCommand("runuser -u root -- rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("runuser root rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("setpriv --reuid 0 --regid 0 --clear-groups rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("chrt -f 5 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("numactl -N 0 -m 0 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("numactl --cpunodebind=0 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("prlimit --nofile=1024 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("prlimit --nofile 1024 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("setarch x86_64 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("setarch -R rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("linux32 rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("bwrap --bind / / rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("bwrap --dev-bind /dev /dev --setenv A B rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("proot -r /x rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("strace -f -o out.txt rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("valgrind --tool=memcheck rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("fakeroot rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("eatmydata rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("perf record rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("perf stat rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("perf record -e cycles rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("screen rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("screen -dmS s rm AGENTS.md")).toBe(true)
  // runuser's user, chrt's priority, and setarch's arch are operands, not the command.
  expect(flagsShellCommand("runuser -u root -- cat AGENTS.md")).toBe(false)
  expect(flagsShellCommand("chrt -f 5 cat AGENTS.md")).toBe(false)
  expect(flagsShellCommand("setarch x86_64 cat AGENTS.md")).toBe(false)
  expect(flagsShellCommand("bwrap --bind / / cat AGENTS.md")).toBe(false)
})

test("an output option of an executor is a write target", () => {
  expect(flagsShellCommand("strace -o AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("strace --output=AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("perf record -o AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("valgrind --log-file=AGENTS.md cat notes.md")).toBe(true)
  expect(flagsShellCommand("strace -o out.txt cat notes.md")).toBe(false)
})

test("tmux executes the shell command of an executing subcommand", () => {
  expect(flagsShellCommand("tmux new-session -d 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("tmux run-shell 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("tmux -c 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("tmux pipe-pane 'cat > AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("sudo tmux run-shell 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("tmux new-session -d 'cat AGENTS.md'")).toBe(false)
  expect(flagsShellCommand("tmux set-option -g status 'rm AGENTS.md'")).toBe(false)
})

test("a wrapper that defaults to a shell executes stdin", () => {
  expect(flagsShellCommand("newgrp grp <<EOF\nrm AGENTS.md\nEOF")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | newgrp grp")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | parallel")).toBe(true)
  expect(flagsShellCommand("echo AGENTS.md | parallel rm")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | sudo -s")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | chroot /x")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | runuser -u root")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | fakeroot")).toBe(true)
  expect(flagsShellCommand("echo rm AGENTS.md | sudo rm")).toBe(false)
})

test("a coproc command is judged under both name interpretations", () => {
  // For a simple command bash runs the first word itself; the word could also be the
  // NAME of a compound coproc, so the remaining words are judged as a command too.
  expect(flagsShellCommand("coproc rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("coproc FOO rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("coproc FOO { rm AGENTS.md; }")).toBe(true)
  expect(flagsShellCommand("coproc { rm AGENTS.md; }")).toBe(true)
  expect(flagsShellCommand("coproc cat AGENTS.md")).toBe(false)
  expect(flagsShellCommand("coproc FOO cat AGENTS.md")).toBe(false)
})

test("eval arguments join into a command that is analyzed again", () => {
  expect(flagsShellCommand("eval rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("eval 'rm' 'AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("echo x | xargs -I{} eval rm AGENTS.md")).toBe(true)
  expect(flagsShellCommand("eval cat AGENTS.md")).toBe(false)
})

test("ssh -o options that run a local command are judged", () => {
  expect(flagsShellCommand("ssh -o ProxyCommand='rm AGENTS.md' host")).toBe(true)
  expect(flagsShellCommand("ssh -o LocalCommand='rm AGENTS.md' host")).toBe(true)
  expect(flagsShellCommand("ssh -o PermitLocalCommand=yes -o LocalCommand='rm AGENTS.md' host")).toBe(true)
  expect(flagsShellCommand("ssh -oProxyCommand='rm AGENTS.md' host")).toBe(true)
  expect(flagsShellCommand("ssh -o ProxyCommand='cat AGENTS.md' host")).toBe(false)
})

test("a write API path variable assigned AGENTS.md in the same script flags", () => {
  expect(flagsShellCommand(`python3 -c "f='AGENTS.md'; open(f,'w').write('x')"`)).toBe(true)
  expect(flagsShellCommand(`python3 -c "f='AGENTS.md'; open(f,'r').read()"`)).toBe(false)
  expect(flagsShellCommand(`python3 -c "f='notes.md'; open(f,'w').write('x')"`)).toBe(false)
  expect(flagsShellCommand(`python3 -c "open('f','w').write('x'); f='AGENTS.md'"`)).toBe(false)
})

test("a call-expression binding resolves the string the constructor takes", () => {
  // A Path('...')/File('...') call binds its first string argument as the path value.
  expect(flagsShellCommand(`python3 -c "from pathlib import Path; p=Path('AGENTS.md'); p.write_text('x')"`)).toBe(true)
  expect(flagsShellCommand(`python3 -c "p=Path('AGENTS.md'); p.unlink()"`)).toBe(true)
  expect(flagsShellCommand(`python3 -c "p=Path('notes.md'); p.write_text('x')"`)).toBe(false)
  expect(flagsShellCommand(`python3 -c "p=Path('AGENTS.md'); p.read_text()"`)).toBe(false)
})

test("a subscript path through a literal bound in the same script flags", () => {
  expect(flagsShellCommand(`python3 -c "d={'k':'AGENTS.md'}; open(d['k'],'w')"`)).toBe(true)
  expect(flagsShellCommand(`python3 -c "l=['AGENTS.md']; open(l[0],'w')"`)).toBe(true)
  expect(flagsShellCommand(`python3 -c "d={'k':'notes.md'}; open(d['k'],'w')"`)).toBe(false)
  expect(flagsShellCommand(`python3 -c "d={'k':'AGENTS.md'}; open(d['k'],'r')"`)).toBe(false)
  expect(flagsShellCommand(`python3 -c "open('f','w')"`)).toBe(false)
})

test("a heredoc body is judged only when its receiver executes it", () => {
  expect(flagsShellCommand("cat <<EOF\nrm AGENTS.md\nEOF")).toBe(false)
  expect(flagsShellCommand("tee notes.md <<EOF\nrm AGENTS.md\nEOF")).toBe(false)
  expect(flagsShellCommand("sh <<EOF\nrm AGENTS.md\nEOF")).toBe(true)
  expect(flagsShellCommand("eval <<EOF\nrm AGENTS.md\nEOF")).toBe(true)
  expect(flagsShellCommand("ssh host <<EOF\nrm AGENTS.md\nEOF")).toBe(true)
  expect(flagsShellCommand("cat <<EOF | sh\nrm AGENTS.md\nEOF")).toBe(true)
})

test("pipeline output feeding a stdin-executing command is judged", () => {
  expect(flagsShellCommand("echo 'rm AGENTS.md' | sh")).toBe(true)
  expect(flagsShellCommand("printf 'rm' ' AGENTS.md' | bash")).toBe(true)
  expect(flagsShellCommand("printf 'rm AGENTS.md' | cat | sh")).toBe(true)
  expect(flagsShellCommand("echo AGENTS.md | sh")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | cat")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | at now")).toBe(true)
  expect(flagsShellCommand("at now <<EOF\nrm AGENTS.md\nEOF")).toBe(true)
})

test("a receiver that already has its program does not execute stdin", () => {
  // eval runs its argv, never stdin; a shell's -c or script file is its program, and
  // su's -c is a program while its operand is a user. Their stdin is data, not commands.
  expect(flagsShellCommand("echo 'rm AGENTS.md' | eval")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | sh -c 'true'")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | bash -lc 'x'")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | sh /tmp/job.sh")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | python3 -c 'x'")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | python3 /tmp/job.py")).toBe(false)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | su -c 'true'")).toBe(false)
  expect(flagsShellCommand("cat <<EOF | sh -c 'true'\nrm AGENTS.md\nEOF")).toBe(false)
})

test("a bare stdin-executing receiver still judges piped commands", () => {
  expect(flagsShellCommand("echo 'rm AGENTS.md' | sh -s")).toBe(true)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | sh -i")).toBe(true)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | su user")).toBe(true)
  expect(flagsShellCommand("echo 'rm AGENTS.md' | su -s sh user")).toBe(true)
  // The -c program itself is still judged as a command.
  expect(flagsShellCommand("echo 'rm AGENTS.md' | sh -c 'rm AGENTS.md'")).toBe(true)
  expect(flagsShellCommand("su -c 'rm AGENTS.md'")).toBe(true)
})

test("a VAR=value word after the command is an argument, not an assignment", () => {
  expect(flagsShellCommand("echo F=AGENTS.md; rm $F")).toBe(false)
  expect(flagsShellCommand("F=AGENTS.md; rm $F")).toBe(true)
})

test("an assignment builtin's NAME=value operands feed variable expansion", () => {
  expect(flagsShellCommand("export F=AGENTS.md; rm $F")).toBe(true)
  expect(flagsShellCommand("declare F=AGENTS.md; rm $F")).toBe(true)
  expect(flagsShellCommand("local F=AGENTS.md; rm $F")).toBe(true)
  expect(flagsShellCommand("readonly F=AGENTS.md; rm $F")).toBe(true)
  expect(flagsShellCommand("typeset F=AGENTS.md; rm $F")).toBe(true)
  expect(flagsShellCommand("declare -r F=AGENTS.md; rm ${F}")).toBe(true)
  expect(flagsShellCommand("export F=notes.md; rm $F")).toBe(false)
  expect(flagsShellCommand("export F; rm $F")).toBe(false)
  expect(flagsShellCommand("echo export F=AGENTS.md; rm $F")).toBe(false)
})
