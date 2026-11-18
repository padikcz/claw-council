declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  export function appendSessionTranscriptMessageByIdentity(
    params: Record<string, unknown>,
  ): Promise<unknown>;

  export function appendAssistantMirrorMessageByIdentity(
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; reason?: string }>;
}
