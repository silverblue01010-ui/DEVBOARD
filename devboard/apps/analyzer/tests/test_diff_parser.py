from app.diff_parser import parse_unified_diff

SAMPLE_DIFF = """diff --git a/src/app.py b/src/app.py
index 1234567..89abcde 100644
--- a/src/app.py
+++ b/src/app.py
@@ -1,3 +1,5 @@
 def hello():
-    print("hi")
+    print("hello")
+    return True
 
"""


def test_parses_file_and_hunk_headers():
    files = parse_unified_diff(SAMPLE_DIFF)
    assert len(files) == 1
    assert files[0].file == "src/app.py"
    assert files[0].language == "python"


def test_added_lines_only_returns_plus_lines():
    files = parse_unified_diff(SAMPLE_DIFF)
    added = files[0].added_lines()
    assert len(added) == 2
    assert added[0].content == '    print("hello")'
    assert added[1].content == "    return True"


def test_empty_diff_returns_no_files():
    assert parse_unified_diff("") == []
