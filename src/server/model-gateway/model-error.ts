export type ModelGatewayErrorCategory =
  | "authentication"
  | "rate_limit"
  | "first_token_timeout"
  | "total_timeout"
  | "connection"
  | "server"
  | "protocol"
  | "cancelled"
  | "interrupted";

const MAX_RETRY_AFTER_MS = 60_000;
const MAX_REQUEST_ID_LENGTH = 256;

const safeMessages: Record<ModelGatewayErrorCategory, string> = {
  authentication: "The model provider rejected authentication.",
  rate_limit: "The model provider is rate limiting requests.",
  first_token_timeout: "The model provider did not start responding in time.",
  total_timeout: "The model provider response exceeded the time limit.",
  connection: "The model provider could not be reached.",
  server: "The model provider failed to process the request.",
  protocol: "The model provider returned an invalid streaming response.",
  cancelled: "The model request was cancelled.",
  interrupted: "The model provider response was interrupted.",
};

export interface ModelGatewayErrorOptions {
  status?: number;
  providerRequestId?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

export class ModelGatewayError extends Error {
  public readonly status?: number;
  public readonly providerRequestId?: string;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;

  constructor(
    public readonly category: ModelGatewayErrorCategory,
    options: ModelGatewayErrorOptions = {},
  ) {
    super(safeMessages[category]);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.status =
      Number.isInteger(options.status) &&
      options.status! >= 100 &&
      options.status! <= 599
        ? options.status
        : undefined;
    this.providerRequestId = options.providerRequestId
      ?.trim()
      .slice(0, MAX_REQUEST_ID_LENGTH);
    this.retryable = options.retryable ?? false;
    this.retryAfterMs =
      typeof options.retryAfterMs === "number" &&
      Number.isFinite(options.retryAfterMs) &&
      options.retryAfterMs >= 0
        ? Math.min(Math.round(options.retryAfterMs), MAX_RETRY_AFTER_MS)
        : undefined;
  }
}
