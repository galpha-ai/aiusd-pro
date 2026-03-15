// StreamEvent types received from server (via ws-pusher)
export interface StreamEventBase {
  type: string;
  timestamp: string;
  runId: string;
  sessionId: string;
  eventId: string;
}

export interface ThinkingEvent extends StreamEventBase {
  type: 'thinking';
  data: { summary: string };
}

export interface ToolUseEvent extends StreamEventBase {
  type: 'tool_use';
  data: { name: string; args: Record<string, unknown> };
}

export interface ToolResultEvent extends StreamEventBase {
  type: 'tool_result';
  data: { name: string; result: string };
}

export interface ContentDeltaEvent extends StreamEventBase {
  type: 'content_delta';
  data: { text: string };
}

export interface ContentCompleteEvent extends StreamEventBase {
  type: 'content_complete';
  data: { text: string; messageId: string };
}

export interface ErrorEvent extends StreamEventBase {
  type: 'error';
  data: { code: string; message: string };
}

export interface SessionInitEvent extends StreamEventBase {
  type: 'session_init';
  data: { claudeSessionId: string };
}

export interface WaitHintReceivedEvent extends StreamEventBase {
  type: 'wait_hint_received';
  data: {
    wait_hint: {
      chain_id?: string;
      tx_hash?: string;
      tx_id?: string;
      type?: string;
      poll_interval_ms?: number;
      timeout_ms?: number;
      system_message?: string;
      [key: string]: unknown;
    };
    tool_name: string;
    tool_input: Record<string, unknown>;
    transaction_status: string | null;
    transaction_error: string | null;
  };
}

export type StreamEvent =
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | ContentDeltaEvent
  | ContentCompleteEvent
  | ErrorEvent
  | SessionInitEvent
  | WaitHintReceivedEvent;

export function isStreamEvent(data: unknown): data is StreamEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'timestamp' in data &&
    'runId' in data &&
    'sessionId' in data
  );
}
