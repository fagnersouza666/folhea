"""SEG-02: exercise Gitleaks itself; fixtures never contain real credentials."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[3]
ALLOWED_PATH = "backend/src/test/java/com/folhea/security/PasswordHasherTest.java"
FALSE_PASSWORD = tomllib.loads((ROOT / ".gitleaks.toml").read_text())["allowlists"][0]["regexes"][0][2:-2]
OTHER_SYNTHETIC = hashlib.sha256(b"SEG-02 synthetic credential, never valid").hexdigest()


class SecretScanTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="seg02-secret-test-")
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name) / "repo"
        self.repo.mkdir(mode=0o700)
        self.binary = os.environ.get("GITLEAKS_BIN", "gitleaks")
        self.git_environment = dict(os.environ, GIT_CONFIG_NOSYSTEM="1",
                                    GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_COUNT="1",
                                    GIT_CONFIG_KEY_0="user.useConfigOnly", GIT_CONFIG_VALUE_0="true")
        self.config = self.repo / ".gitleaks.toml"
        if (ROOT / ".gitleaks.toml").exists():
            shutil.copyfile(ROOT / ".gitleaks.toml", self.config)
        else:
            self.config.write_text("[extend]\nuseDefault = true\n")

    def fixture(self, path, value, suffix=""):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        key = "pass" + "word"
        target.write_text(f"String {key} = {json.dumps(value)}; {suffix}\n")
        return target

    def scan_files(self):
        report = Path(self.directory.name) / "report.json"
        result = subprocess.run([
            self.binary, "dir", ".", "--config", str(self.config),
            "--redact=100", "--no-banner", "--log-level", "error",
            "--gitleaks-ignore-path", os.devnull, "--ignore-gitleaks-allow",
            "--report-format", "json", "--report-path", str(report),
        ], capture_output=True, cwd=self.repo)
        count = len(json.loads(report.read_text())) if report.exists() else -1
        return result.returncode, count

    def test_only_the_documented_false_password_at_the_exact_path_is_allowed(self):
        self.fixture(ALLOWED_PATH, FALSE_PASSWORD)
        self.assertEqual(self.scan_files(), (0, 0))

    def test_the_same_false_password_at_another_path_is_rejected(self):
        self.fixture("outside/PasswordHasherTest.java", FALSE_PASSWORD)
        code, count = self.scan_files()
        self.assertEqual(code, 1)
        self.assertGreater(count, 0)

    def test_another_secret_at_the_allowed_path_is_rejected(self):
        self.fixture(ALLOWED_PATH, OTHER_SYNTHETIC)
        code, count = self.scan_files()
        self.assertEqual(code, 1)
        self.assertGreater(count, 0)

    def test_a_path_suffix_does_not_extend_the_exception(self):
        self.fixture(ALLOWED_PATH + ".copy", FALSE_PASSWORD)
        self.assertEqual(self.scan_files()[0], 1)

    def test_allow_comments_cannot_silence_another_finding(self):
        self.fixture("outside/fixture.java", OTHER_SYNTHETIC, "// gitleaks:allow")
        self.assertEqual(self.scan_files()[0], 1)

    def git(self, *arguments):
        return subprocess.run(["git", "-c", "user.name=SEG02 fixture", "-c",
                               "user.email=fixture@example.invalid", "-C", str(self.repo), *arguments],
                              check=True, capture_output=True, env=self.git_environment)

    def commit(self):
        self.git("add", ".")
        self.git("-c", "user.name=SEG02 fixture", "-c",
                 "user.email=fixture@example.invalid", "commit", "-m", "fixture")

    def history(self):
        self.git("init", "-q")
        self.commit()

    def run_gate(self, repository=None):
        return subprocess.run([
            "python3", "-B", str(ROOT / "scripts/ci/scan-secrets.py"),
            "--repository", str(repository or self.repo), "--gitleaks", self.binary,
        ], capture_output=True)

    def test_a_clean_history_passes(self):
        self.history()
        result = self.run_gate()
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"0 findings", result.stdout)

    def test_the_documented_false_positive_is_allowed_in_real_git_history(self):
        self.fixture(ALLOWED_PATH, FALSE_PASSWORD)
        self.history()
        self.assertEqual(self.run_gate().returncode, 0)

    def test_a_secret_removed_from_head_still_fails_without_value_in_output(self):
        target = self.fixture("outside/history.java", FALSE_PASSWORD)
        self.history()
        target.unlink()
        self.commit()
        result = self.run_gate()
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"1 findings", result.stdout)
        self.assertNotIn(FALSE_PASSWORD.encode(), result.stdout + result.stderr)

    def test_a_secret_introduced_only_by_a_merge_is_not_missed(self):
        self.history()
        branch = self.git("branch", "--show-current").stdout.decode().strip()
        self.git("branch", "side")
        (self.repo / "right.txt").write_text("right\n")
        self.commit()
        self.git("checkout", "side")
        (self.repo / "left.txt").write_text("left\n")
        self.commit()
        self.git("checkout", branch)
        self.git("merge", "--no-commit", "--no-ff", "side")
        self.fixture("outside/merge.java", FALSE_PASSWORD)
        self.commit()
        self.assertEqual(self.run_gate().returncode, 1)

    def test_moving_the_false_password_outside_its_exact_path_is_rejected(self):
        self.fixture(ALLOWED_PATH, FALSE_PASSWORD)
        self.history()
        (self.repo / "outside").mkdir()
        self.git("mv", ALLOWED_PATH, "outside/fixture.java")
        self.commit()
        self.assertEqual(self.run_gate().returncode, 1)

    def test_an_unreachable_canary_branch_does_not_contaminate_head(self):
        self.history()
        branch = self.git("branch", "--show-current").stdout.decode().strip()
        self.git("checkout", "-b", "canary")
        self.fixture("outside/canary.java", FALSE_PASSWORD)
        self.commit()
        self.git("checkout", branch)
        self.assertEqual(self.run_gate().returncode, 0)

    def test_a_shallow_checkout_is_rejected(self):
        self.history()
        clone = Path(self.directory.name) / "shallow"
        subprocess.run(["git", "clone", "--quiet", "--depth=1", self.repo.as_uri(),
                        str(clone)], check=True, capture_output=True)
        result = self.run_gate(clone)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"full Git history", result.stderr)

    def test_invalid_config_fails_closed_without_printing_its_content(self):
        self.config.write_text("not valid TOML " + OTHER_SYNTHETIC)
        self.history()
        result = self.run_gate()
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"failed closed", result.stderr)
        self.assertNotIn(OTHER_SYNTHETIC.encode(), result.stdout + result.stderr)

    def test_fingerprint_ignore_file_cannot_hide_a_secret(self):
        self.fixture("outside/fixture.java", FALSE_PASSWORD)
        self.history()
        report = Path(self.directory.name) / "fingerprints.json"
        subprocess.run([
            self.binary, "git", str(self.repo), "--config", str(self.config),
            "--redact=100", "--report-format", "json", "--report-path", str(report),
        ], capture_output=True)
        findings = json.loads(report.read_text())
        self.assertGreater(len(findings), 0)
        (self.repo / ".gitleaksignore").write_text(
            "\n".join(finding["Fingerprint"] for finding in findings) + "\n")
        result = self.run_gate()
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"fingerprint ignore files are not allowed", result.stderr)


if __name__ == "__main__":
    unittest.main()
