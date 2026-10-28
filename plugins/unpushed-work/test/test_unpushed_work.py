import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "bin" / "unpushed-work"


class Machine:
    """A throwaway $HOME laid out like the user's: ~/VSCode, ~/VSCode/worktrees, ~/.codex/worktrees."""

    def __init__(self, home: Path):
        self.home = home
        self.env = {
            "HOME": str(home),
            "PATH": os.environ["PATH"],
            "GIT_CONFIG_GLOBAL": str(home / ".gitconfig"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@t",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@t",
        }
        (home / ".gitconfig").write_text("[init]\n\tdefaultBranch = main\n")

    def git(self, cwd: Path, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=cwd, env=self.env, capture_output=True, text=True, check=True
        ).stdout

    def checkout(self, name: str) -> Path:
        """A main checkout at ~/VSCode/<name> cloned from a bare remote, with main pushed."""
        remote = self.home / "remotes" / f"{name}.git"
        remote.mkdir(parents=True)
        self.git(remote, "init", "--bare", "-q")
        repo = self.home / "VSCode" / name
        repo.parent.mkdir(parents=True, exist_ok=True)
        self.git(self.home, "clone", "-q", str(remote), str(repo))
        self.commit(repo, "README")
        self.git(repo, "push", "-q", "-u", "origin", "main")
        return repo

    def commit(self, repo: Path, filename: str) -> None:
        (repo / filename).write_text(filename)
        self.git(repo, "add", filename)
        self.git(repo, "commit", "-q", "-m", filename)

    def run(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(SCRIPT), *args], env=self.env, capture_output=True, text=True, timeout=60
        )


class UnpushedWorkTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.machine = Machine(Path(self._tmp.name).resolve())

    def tearDown(self):
        self._tmp.cleanup()

    def test_clean_pushed_checkout_prints_nothing_and_succeeds(self):
        self.machine.checkout("app")

        result = self.machine.run()

        self.assertEqual(result.stdout, "")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_reports_uncommitted_and_untracked_files(self):
        repo = self.machine.checkout("app")
        (repo / "README").write_text("edited")
        (repo / "new.txt").write_text("new")

        result = self.machine.run()

        self.assertIn(f"{repo}: 2 uncommitted path(s) on main\n", result.stdout)
        self.assertEqual(result.returncode, 1)

    def test_reports_branch_ahead_of_upstream(self):
        repo = self.machine.checkout("app")
        self.machine.commit(repo, "a")
        self.machine.commit(repo, "b")

        result = self.machine.run()

        self.assertEqual(result.stdout, f"{repo}: branch main is 2 commit(s) ahead of origin/main\n")
        self.assertEqual(result.returncode, 1)

    def test_reports_branch_without_upstream_holding_commits_on_no_remote(self):
        repo = self.machine.checkout("app")
        self.machine.git(repo, "switch", "-q", "-c", "feature")
        self.machine.commit(repo, "a")
        self.machine.git(repo, "switch", "-q", "main")

        result = self.machine.run()

        self.assertEqual(result.stdout, f"{repo}: branch feature has no upstream; 1 commit(s) on no remote\n")
        self.assertEqual(result.returncode, 1)

    def test_reports_branch_whose_upstream_is_gone(self):
        repo = self.machine.checkout("app")
        self.machine.git(repo, "switch", "-q", "-c", "feature")
        self.machine.git(repo, "push", "-q", "-u", "origin", "feature")
        self.machine.commit(repo, "a")
        self.machine.git(repo, "push", "-q", "origin", "--delete", "feature")
        self.machine.git(repo, "switch", "-q", "main")

        result = self.machine.run()

        self.assertEqual(result.stdout, f"{repo}: branch feature has no upstream; 1 commit(s) on no remote\n")

    def test_reports_dirty_linked_worktree_and_its_branch_once(self):
        repo = self.machine.checkout("app")
        worktree = self.machine.home / "VSCode" / "worktrees" / "app-feature"
        self.machine.git(repo, "worktree", "add", "-q", "-b", "feature", str(worktree))
        (worktree / "wip.txt").write_text("wip")
        self.machine.commit(worktree, "a")

        result = self.machine.run()

        self.assertEqual(
            result.stdout,
            f"{worktree}: 1 uncommitted path(s) on feature\n"
            f"{repo}: branch feature has no upstream; 1 commit(s) on no remote\n",
        )

    def test_reports_nested_codex_worktree_of_a_checkout_outside_vscode(self):
        repo = self.machine.checkout("app")
        elsewhere = self.machine.home / "elsewhere" / "app"
        elsewhere.parent.mkdir()
        repo.rename(elsewhere)
        worktree = self.machine.home / ".codex" / "worktrees" / "task" / "app"
        self.machine.git(elsewhere, "worktree", "add", "-q", "--detach", str(worktree))
        (worktree / "wip.txt").write_text("wip")

        result = self.machine.run()

        self.assertEqual(result.stdout, f"{worktree}: 1 uncommitted path(s) on (detached)\n")

    def test_since_reports_evidence_files_changed_after_that_time_without_failing(self):
        evidence = self.machine.home / ".local" / "share" / "opencode" / "evidence"
        (evidence / "run").mkdir(parents=True)
        (evidence / "run" / "new.md").write_text("new")
        old = evidence / "old.md"
        old.write_text("old")
        os.utime(old, (1_600_000_000, 1_600_000_000))

        result = self.machine.run("--since", "2026-01-01T00:00:00Z")

        self.assertEqual(
            result.stdout,
            f"evidence: 1 file(s) changed since 2026-01-01T00:00:00Z in {evidence} (not in git)\n",
        )
        self.assertEqual(result.returncode, 0)

    def test_broken_worktree_is_one_problem_and_other_repositories_still_report(self):
        repo = self.machine.checkout("app")
        (repo / "wip.txt").write_text("wip")
        broken = self.machine.home / "VSCode" / "worktrees" / "stale"
        broken.mkdir(parents=True)
        (broken / ".git").write_text(f"gitdir: {self.machine.home}/missing/.git/worktrees/stale\n")

        result = self.machine.run()

        self.assertIn(f"{repo}: 1 uncommitted path(s) on main\n", result.stdout)
        self.assertIn(f"{broken}: cannot inspect: ", result.stdout)
        self.assertEqual(result.returncode, 1)

    def test_reports_detached_head_commits_on_no_branch_or_remote(self):
        repo = self.machine.checkout("app")
        worktree = self.machine.home / ".codex" / "worktrees" / "task"
        self.machine.git(repo, "worktree", "add", "-q", "--detach", str(worktree))
        self.machine.commit(worktree, "a")

        result = self.machine.run()

        self.assertEqual(result.stdout, f"{worktree}: detached HEAD has 1 commit(s) on no branch or remote\n")
        self.assertEqual(result.returncode, 1)

    def test_rejects_malformed_since_without_a_traceback(self):
        result = self.machine.run("--since", "yesterday")

        self.assertEqual(result.returncode, 2)
        self.assertNotIn("Traceback", result.stderr)

    def test_ignores_branch_without_upstream_whose_commits_are_on_a_remote(self):
        repo = self.machine.checkout("app")
        self.machine.git(repo, "branch", "local-alias", "main")

        result = self.machine.run()

        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
