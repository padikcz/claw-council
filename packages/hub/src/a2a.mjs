import { randomUUID } from "node:crypto";

function rpcBody(method, params) {
  return {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    params,
  };
}

async function call(agent, body, timeoutMs = agent.timeoutMs) {
  const response = await fetch(agent.a2aUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${agent.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`A2A endpoint returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`A2A error ${payload.error.code}: ${payload.error.message}`);
  }
  return payload.result;
}

export async function sendMessage(agent, { input, contextId }) {
  const result = await call(
    agent,
    rpcBody("SendMessage", {
      message: {
        messageId: randomUUID(),
        contextId,
        role: "ROLE_USER",
        parts: [{ text: input }],
      },
    }),
  );
  return normalizeTask(result?.task);
}

export async function getTask(agent, taskId) {
  const result = await call(agent, rpcBody("GetTask", { id: taskId }), 15_000);
  return normalizeTask(result);
}

export function normalizeTask(task) {
  if (!task || typeof task !== "object") {
    throw new Error("A2A endpoint returned no task");
  }
  const state = task.status?.state ?? "TASK_STATE_UNKNOWN";
  const output = (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts ?? [])
    .map((part) => part.text)
    .filter((text) => typeof text === "string" && text.length > 0)
    .join("\n") || undefined;

  let status = "working";
  if (state === "TASK_STATE_COMPLETED") status = "completed";
  else if (state === "TASK_STATE_FAILED") status = "failed";
  else if (state === "TASK_STATE_REJECTED") status = "rejected";

  return {
    taskId: task.id,
    contextId: task.contextId,
    status,
    output,
  };
}

export async function probeAgent(agent, timeoutMs) {
  const startedAt = Date.now();
  try {
    const response = await fetch(agent.healthUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const card = await response.json();
    return {
      online: true,
      latencyMs: Date.now() - startedAt,
      name: typeof card.name === "string" ? card.name : undefined,
    };
  } catch (error) {
    return {
      online: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
