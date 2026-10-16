"""Small, fail-closed checks for the repository's explicit workflow contracts."""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]


def reads_repository_secret(source):
    expressions = re.findall(r"\$\{\{(.*?)\}\}", source, re.DOTALL)
    return any(re.search(r"\bsecrets\s*(?:\.|\[)", expression)
               for expression in expressions)


class WorkflowSecurityTest(unittest.TestCase):
    def test_untrusted_pull_request_events_never_have_the_privileged_target_event(self):
        for path in (ROOT / ".github/workflows").glob("*.y*ml"):
            source = path.read_text()
            self.assertIsNone(re.search(r"\bpull_request_target\b", source), path.name)

    def test_workflows_triggered_by_pull_requests_never_reference_repository_secrets(self):
        for path in (ROOT / ".github/workflows").glob("*.y*ml"):
            source = path.read_text()
            events = source.partition("\njobs:")[0]
            if re.search(r"\bpull_request\b", events):
                self.assertFalse(reads_repository_secret(source), path.name)

    def test_the_required_secret_check_runs_on_every_push_and_pull_request(self):
        source = (ROOT / ".github/workflows/security.yml").read_text()
        events = source.partition("\njobs:")[0]
        self.assertRegex(events, r"(?m)^  pull_request:\s*$")
        push = re.search(r"(?m)^  push:\s*\n((?:    [^\n]*\n)*)", events)
        self.assertIsNotNone(push)
        self.assertNotIn("branches", push.group(1))
        self.assertNotIn("paths", push.group(1))

    def test_secret_scan_uses_full_history_without_repository_secret_or_uploaded_findings(self):
        source = (ROOT / ".github/workflows/security.yml").read_text()
        job = source.split("  secret-scan:\n", 1)[1].split("\n  filesystem-scan:", 1)[0]
        self.assertIn("name: Secret scan (Gitleaks)", job)
        self.assertIn("fetch-depth: 0", job)
        self.assertIn("persist-credentials: false", job)
        self.assertIn("python3 -B scripts/ci/scan-secrets.py", job)
        self.assertNotIn("upload-artifact", job)
        self.assertNotIn("continue-on-error", job)
        self.assertFalse(reads_repository_secret(job))

    def test_secret_expression_policy_handles_dot_and_index_without_filename_false_positive(self):
        self.assertTrue(reads_repository_secret("${{ secrets.EXAMPLE }}"))
        self.assertTrue(reads_repository_secret("${{ secrets['EXAMPLE'] }}"))
        self.assertFalse(reads_repository_secret("python3 scan-secrets.py"))


if __name__ == "__main__":
    unittest.main()
