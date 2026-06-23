# Scope Guardrails

DevBoard's scope:
1. Automated review of GitHub Pull Requests
2. Rule-based and ML-powered analysis of code diffs
3. Policy enforcement at merge time
4. Integration with downstream tooling (Slack, Jira, CI)

DevBoard is explicitly **not**:
- A replacement for human code review — it augments reviewers, never removes the need for them.
- A general-purpose CI/CD system — it does not run builds, deployments, or arbitrary test suites.
- An AI pair programmer or coding assistant — it reviews completed diffs, not active coding.
- A code search or documentation tool — it does not index repositories for search.
- A project management tool — it does not manage sprints, epics, or roadmaps.

## Evaluation checklist for any proposed feature

Before writing code for a new feature, answer:

1. Does this fall within DevBoard's defined scope? (yes / no / partial)
2. If partial or no: what is the nearest in-scope version of this feature?
3. What is the risk of adding this out-of-scope feature? (scope creep, maintenance burden, user confusion)
4. Recommendation: implement as described / implement reduced in-scope version / reject

## Worked examples

| Proposal | Verdict | Reasoning |
|---|---|---|
| Run the full test suite on PR | Out of scope (CI's job) | In-scope version: report test-coverage gaps in the diff only (shipped in Phase 2). |
| PR template generator | Out of scope (dev tooling/PM) | Reject. |
| GitLab MR support | Partial — same problem, different platform | Valid future scope, but outside current phases. Backlog. |
| Chatbot for codebase Q&A | Out of scope | Reject — this is a code-search/assistant product, not a review gate. |
