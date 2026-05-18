export type LlmFailureReason = "timeout" | "validation_error" | "api_error" | "empty_output" | "malformed_json";

export type SerializedLlmFailure = {
  reason: LlmFailureReason;
  message: string;
  model: string | null;
};

export class LlmGenerationError extends Error {
  readonly reason: LlmFailureReason;
  readonly model: string | null;

  constructor(reason: LlmFailureReason, message: string, options: { model?: string | null } = {}) {
    super(message);
    this.name = "LlmGenerationError";
    this.reason = reason;
    this.model = options.model ?? null;
  }
}

export function toLlmGenerationError(error: unknown, fallbackReason: LlmFailureReason = "api_error"): LlmGenerationError {
  if (error instanceof LlmGenerationError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new LlmGenerationError(fallbackReason, message);
}

export function classifyLlmFailure(error: unknown): LlmFailureReason | null {
  if (error instanceof LlmGenerationError) {
    return error.reason;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timed out") || message.includes("abort")) {
    return "timeout";
  }

  if (message.includes("validation")) {
    return "validation_error";
  }

  if (message.includes("did not include json text") || message.includes("no output_text")) {
    return "empty_output";
  }

  if (message.includes("invalid json") || message.includes("malformed")) {
    return "malformed_json";
  }

  if (message.includes("openai") || message.includes("http") || message.includes("network") || message.includes("response")) {
    return "api_error";
  }

  return null;
}

export function serializeLlmFailure(error: unknown): SerializedLlmFailure | null {
  const reason = classifyLlmFailure(error);
  if (!reason) {
    return null;
  }

  const llmError = error instanceof LlmGenerationError ? error : null;
  return {
    reason,
    message: error instanceof Error ? error.message : String(error),
    model: llmError?.model ?? null
  };
}
