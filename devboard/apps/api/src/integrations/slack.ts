import axios from "axios";
import { logger } from "../lib/logger";
import { Finding } from "@devboard/shared";

export interface SlackNotifyParams {
  webhookUrl: string;
  channel?: string;
  prUrl: string;
  finding?: Finding;
  gateFailureMessage?: string;
}

/**
 * Posts a concise, actionable Slack message via Incoming Webhook + Block Kit.
 * Triggered on: critical finding, or policy gate failure (see devboard.config.yml
 * notifications.slack.on).
 */
export async function notifySlack(params: SlackNotifyParams): Promise<void> {
  const { webhookUrl, channel, prUrl, finding, gateFailureMessage } = params;

  const text = gateFailureMessage
    ? `🚫 DevBoard policy gate failed: ${gateFailureMessage}`
    : `🔴 DevBoard found a critical finding: ${finding?.ruleId} in ${finding?.file}:${finding?.line}`;

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View on GitHub" },
          url: prUrl,
        },
      ],
    },
  ];

  try {
    await axios.post(webhookUrl, { channel, blocks }, { timeout: 5000 });
  } catch (err) {
    logger.error({ err }, "failed to deliver Slack notification");
  }
}

/** Generic plain-text Slack message delivery, used by the weekly digest. */
export async function postSlackMessage(webhookUrl: string, text: string, channel?: string): Promise<void> {
  try {
    await axios.post(webhookUrl, { channel, text }, { timeout: 5000 });
  } catch (err) {
    logger.error({ err }, "failed to deliver Slack digest message");
  }
}
