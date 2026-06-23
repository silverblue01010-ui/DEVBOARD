#!/usr/bin/env node
import { Command } from "commander";
import axios from "axios";
import fs from "fs";
import Table from "cli-table3";
import type { AnalyzeResponse, Finding } from "@devboard/shared";

const ANALYZER_URL = process.env.ANALYZER_URL || "http://localhost:8000";

const program = new Command();
program.name("devboard").description("DevBoard local CLI — run the analysis pipeline outside CI").version("0.1.0");

async function fetchDiffFromGitHub(repo: string, prNumber: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN env var is required to fetch a PR diff from GitHub (use a PAT with repo read access).");
  }
  const { data } = await axios.get(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3.diff" },
  });
  return data as string;
}

function severityRank(s: Finding["severity"]): number {
  return { critical: 0, warning: 1, suggestion: 2 }[s];
}

function printFindingsTable(findings: Finding[]) {
  if (findings.length === 0) {
    console.log("No findings.");
    return;
  }
  const table = new Table({ head: ["Severity", "Rule", "File", "Line", "Message"] });
  for (const f of [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))) {
    table.push([f.severity, f.ruleId, f.file, String(f.line), f.message]);
  }
  console.log(table.toString());
}

async function runAnalysis(repoFullName: string, prNumber: number, headSha: string, diff: string) {
  const { data } = await axios.post<AnalyzeResponse>(`${ANALYZER_URL}/analyze`, {
    repoFullName,
    prNumber,
    headSha,
    diff,
  });

  console.log(`\nSummary: ${data.summary || "(no LLM summary — ANTHROPIC_API_KEY not configured?)"}`);
  console.log(`Risk level: ${data.riskLevel}\n`);

  console.log("Rule findings:");
  printFindingsTable(data.ruleFindings);

  console.log("\nML (LLM) findings:");
  printFindingsTable(data.llmFindings);

  if (data.testCoverageGaps.length > 0) {
    console.log("\nTest coverage gaps:");
    printFindingsTable(data.testCoverageGaps);
  }
}

program
  .command("analyze")
  .description(
    "Run the full DevBoard analysis pipeline locally — talks to the same analyzer service the production worker uses, no separate logic."
  )
  .option("--diff <file>", "path to a local unified diff file")
  .option("--repo <owner/repo>", "GitHub repo to pull a live PR diff from (used with --pr-number)")
  .option("--pr-number <number>", "PR number to pull a live diff from (used with --repo)")
  .action(async (opts) => {
    try {
      let diff: string;
      let repoFullName = "local/diff";
      let prNumber = 0;

      if (opts.diff) {
        diff = fs.readFileSync(opts.diff, "utf8");
      } else if (opts.repo && opts.prNumber) {
        repoFullName = opts.repo;
        prNumber = Number(opts.prNumber);
        diff = await fetchDiffFromGitHub(opts.repo, opts.prNumber);
      } else {
        console.error("Provide either --diff <file>, or both --repo <owner/repo> and --pr-number <n>.");
        console.error("Examples:");
        console.error("  npx devboard analyze --diff ./my.diff");
        console.error("  npx devboard analyze --repo acme/widgets --pr-number 42");
        process.exit(1);
        return;
      }

      await runAnalysis(repoFullName, prNumber, "local", diff);
    } catch (err: any) {
      console.error("devboard analyze failed:", err.message || err);
      process.exit(1);
    }
  });

program.parse(process.argv);
