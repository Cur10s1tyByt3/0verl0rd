import { logger } from "../logger";

export function isAuthorizedAgentRequest(
  req: Request,
  url: URL,
  agentToken?: string,
): boolean {
  const disableAuth =
    String(process.env.OVERLORD_DISABLE_AGENT_AUTH || "").toLowerCase() ===
    "true";
  if (disableAuth) {
    logger.info("[auth] Agent auth explicitly disabled by OVERLORD_DISABLE_AGENT_AUTH=true");
    return true;
  }

  const token = agentToken?.trim();
  if (!token) {
    logger.info("[auth] Agent auth disabled");
    return true;
  }

  const headerToken = req.headers.get("x-agent-token");
  const queryToken = url.searchParams.get("token");
  const isAuthed = headerToken === token || queryToken === token;

  if (!isAuthed) {
    logger.info("[auth] Agent auth failed");
  } else {
    logger.info("[auth] Agent authenticated successfully");
  }

  return isAuthed;
}
