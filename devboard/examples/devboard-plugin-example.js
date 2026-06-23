#!/usr/bin/env node
/**
 * Example DevBoard plugin. Plugins receive {diff, existingFindings} as JSON on
 * stdin and must print a JSON array of findings (standard Finding schema) to
 * stdout. Plugin findings are always treated as suggestion severity — never
 * blocking — regardless of what severity is set here.
 *
 * Runs with no network access and a 10-second timeout (enforced by the host,
 * see apps/api/src/plugins/runner.ts).
 */
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const { diff } = JSON.parse(input);
  const findings = [];

  for (const file of diff) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add" && /\bvar\s+/.test(line.content)) {
          findings.push({
            ruleId: "CUSTOM-NO-VAR",
            source: "PLUGIN",
            severity: "suggestion",
            file: file.file,
            line: line.lineNumber,
            message: "Use let/const instead of var",
            why: "var has function-scoping semantics that often surprise readers used to block-scoped let/const.",
            suggestion: "Replace var with let or const.",
            confidence: 0.6,
          });
        }
      }
    }
  }

  console.log(JSON.stringify(findings));
});
