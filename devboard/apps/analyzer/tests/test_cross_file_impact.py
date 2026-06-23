from app.cross_file_impact import find_dependents, build_impact_summary


def test_finds_dependent_via_relative_js_import():
    repo_files = {
        "src/utils/auth.ts": "export function login() {}",
        "src/components/LoginForm.tsx": "import { login } from '../utils/auth';",
    }
    dependents = find_dependents("src/utils/auth.ts", repo_files)
    assert "src/components/LoginForm.tsx" in dependents


def test_no_dependents_when_nothing_imports_the_file():
    repo_files = {
        "src/utils/auth.ts": "export function login() {}",
        "src/components/Unrelated.tsx": "export function Unrelated() { return null; }",
    }
    dependents = find_dependents("src/utils/auth.ts", repo_files)
    assert dependents == []


def test_build_impact_summary_skips_files_with_no_dependents():
    repo_files = {
        "src/a.py": "x = 1",
        "src/b.py": "from a import x",
    }
    summary = build_impact_summary(["src/a.py"], repo_files)
    assert "src/a.py" in summary
    assert summary["src/a.py"] == ["src/b.py"]
