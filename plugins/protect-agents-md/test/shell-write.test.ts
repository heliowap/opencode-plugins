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
