import { spawn } from "child_process";
import { Finding, ParsedFileDiff } from "@devboard/shared";
import { logger } from "../lib/logger";

const PLUGIN_TIMEOUT_MS = 10_000;

export interface PluginDef {
  name: string;
  path: string; // relative to repo root, e.g. .devboard/plugins/my-rules.js
  language: "node" | "python";
}

/**
 * Runs a single plugin in a sandboxed subprocess with no network access and a
 * hard timeout. A failing plugin must never fail the analysis job — errors are
 * caught and logged, and an empty finding list is returned instead.
 */
export async function runPlugin(
  plugin: PluginDef,
  pluginAbsolutePath: string,
  diff: ParsedFileDiff[],
  existingFindings: Finding[]
): Promise<Finding[]> {
  return new Promise((resolve) => {
    const cmd = plugin.language === "node" ? "node" : "python3";
    // --no-network style sandboxing is enforced at the container/cgroup level in production
    // (e.g. a network-namespace-less subprocess or a separate unprivileged container).
    // Here we additionally pass an env flag the plugin runtime can check.
    const child = spawn(cmd, [pluginAbsolutePath], {
      env: { ...process.env, DEVBOARD_PLUGIN_SANDBOX: "1", NO_NETWORK: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      logger.warn({ plugin: plugin.name }, "plugin timed out, no findings used");
      resolve([]);
    }, PLUGIN_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.warn({ plugin: plugin.name, code, stderr }, "plugin exited non-zero, no findings used");
        return resolve([]);
      }
      try {
        const parsed = JSON.parse(stdout) as Finding[];
        // Plugin findings are always suggestion severity, never blocking (Phase 3 constraint).
        resolve(parsed.map((f) => ({ ...f, source: "PLUGIN" as const, severity: "suggestion" as const })));
      } catch (err) {
        logger.warn({ plugin: plugin.name, err }, "plugin produced invalid JSON, no findings used");
        resolve([]);
      }
    });

    child.stdin.write(JSON.stringify({ diff, existingFindings }));
    child.stdin.end();
  });
}
