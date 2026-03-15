import WebSocket from 'ws';
import { request } from 'undici';
import { config } from './config.js';
import { StreamEvent, WaitHintReceivedEvent, isStreamEvent } from './types.js';

export interface SendOptions {
  sessionId: string;
  message: string;
  token: string;
  userId: string;
  verbose?: boolean;
  timeoutMs?: number;
}

/** Result from a single subscribe-and-stream cycle. */
interface StreamResult {
  /** 'done' = content_complete received, 'wait_hint' = transaction pending. */
  outcome: 'done' | 'wait_hint';
  waitHint?: WaitHintReceivedEvent['data'];
}

/**
 * Send a message to the AIUSD agent and stream the response to stdout.
 *
 * Flow:
 * 1. POST /chat to initiate the agent run (creates Redis Stream)
 * 2. Connect to ws-pusher WebSocket and subscribe to session channel
 * 3. Filter events by runId to ignore events from previous runs
 * 4. On content_complete → done
 * 5. On wait_hint_received → poll transaction → send resume_context → repeat from step 1
 */
export async function sendMessage(options: SendOptions): Promise<void> {
  const { sessionId, message, token, userId, verbose, timeoutMs } = options;
  const effectiveTimeout = timeoutMs || config.timeoutMs;
  const deadline = Date.now() + effectiveTimeout;

  // Step 1: POST /chat to start the agent run
  let currentMessage = message;
  let isResume = false;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timeout after ${effectiveTimeout}ms`);
    }

    const { runId } = await postChat(sessionId, currentMessage, token, userId, remaining);

    if (verbose) {
      process.stderr.write(`[chat] run ${runId} started for session ${sessionId}${isResume ? ' (resume)' : ''}\n`);
    }

    // Step 2: Subscribe and stream
    const result = await subscribeWithRetry(sessionId, runId, remaining, verbose);

    if (result.outcome === 'done') {
      return;
    }

    // Step 3: Handle wait_hint — poll transaction, then resume
    const hint = result.waitHint!;
    const txKey = hint.wait_hint.tx_hash || hint.wait_hint.tx_id;
    const chainId = hint.wait_hint.chain_id;

    if (!txKey || !chainId) {
      if (verbose) {
        process.stderr.write(`[wait_hint] missing tx_hash/tx_id or chain_id, skipping resume\n`);
      }
      return;
    }

    // If transaction_status already indicates confirmed, skip polling
    const alreadyConfirmed = hint.transaction_status?.includes('CONFIRMED');
    let txResult: { status: string; error?: string };

    if (alreadyConfirmed) {
      if (verbose) {
        process.stderr.write(`[wait_hint] transaction already confirmed (${hint.transaction_status}), sending resume\n`);
      }
      txResult = { status: 'confirmed' };
    } else {
      if (verbose) {
        process.stderr.write(`[wait_hint] polling transaction ${txKey} on ${chainId}...\n`);
      }
      txResult = await pollTransaction(
        hint.wait_hint,
        hint.wait_hint.poll_interval_ms || 3000,
        hint.wait_hint.timeout_ms || 120_000,
        token,
        userId,
        verbose,
      );
    }

    // Build resume_context message (matches frontend format)
    const resumePayload: Record<string, unknown> = {
      resume_context: {
        type: 'transaction_results',
        results: {
          [txKey]: {
            status: txResult.status,
            tx_hash: hint.wait_hint.tx_hash || null,
            tx_id: hint.wait_hint.tx_id || null,
            chain_id: chainId,
            ...(txResult.error ? { error: txResult.error } : {}),
            ...(hint.wait_hint.system_message ? { system_message: hint.wait_hint.system_message } : {}),
          },
        },
      },
      system_message: 'The above transactions have been completed. Continue executing your plan. Complete ALL remaining steps. Do NOT stop until every task in your TodoWrite list is finished.',
    };
    currentMessage = JSON.stringify(resumePayload);
    isResume = true;
  }
}

const SUBSCRIBE_RETRY_DELAY_MS = 1000;
const SUBSCRIBE_MAX_RETRIES = 15;

async function subscribeWithRetry(
  sessionId: string,
  runId: string,
  timeoutMs: number,
  verbose?: boolean,
): Promise<StreamResult> {
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; attempt < SUBSCRIBE_MAX_RETRIES; attempt++) {
    if (Date.now() >= deadline) {
      throw new Error(`Timeout waiting for stream to become available`);
    }

    try {
      return await subscribeAndStream(sessionId, runId, deadline - Date.now(), verbose);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('does not exist')) {
        if (verbose) {
          process.stderr.write(`[ws] stream not ready, retrying in ${SUBSCRIBE_RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${SUBSCRIBE_MAX_RETRIES})\n`);
        }
        await new Promise(r => setTimeout(r, SUBSCRIBE_RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Stream not available after ${SUBSCRIBE_MAX_RETRIES} retries`);
}

function subscribeAndStream(
  sessionId: string,
  runId: string,
  remainingMs: number,
  verbose?: boolean,
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let outputText = '';

    const ws = new WebSocket(config.wsUrl);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Timeout after ${remainingMs}ms`));
      }
    }, remainingMs);

    const finish = (result: StreamResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (outputText && !outputText.endsWith('\n')) {
          process.stdout.write('\n');
        }
        ws.send(JSON.stringify({ type: 'unsubscribe', channel: sessionId }));
        ws.close();
        resolve(result);
      }
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: sessionId,
      }));
    });

    ws.on('message', (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const msgType = msg.type as string;

      if (msgType === 'subscribed') {
        if (verbose) {
          process.stderr.write(`[ws] subscribed to ${msg.channel}\n`);
        }
        return;
      }

      if (msgType === 'error') {
        const errMsg = (msg.message as string) || 'Unknown ws-pusher error';
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          reject(new Error(errMsg));
        }
        return;
      }

      if (msgType === 'event') {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (!payload) return;

        // isStreamEvent checks for type+timestamp+runId+sessionId
        // wait_hint_received also has these fields, so it passes the guard
        if (!isStreamEvent(payload)) return;

        const event = payload as unknown as StreamEvent;

        // Skip events from previous runs
        if (event.runId !== runId) return;

        switch (event.type) {
          case 'content_delta':
            process.stdout.write(event.data.text);
            outputText += event.data.text;
            break;

          case 'content_complete':
            finish({ outcome: 'done' });
            break;

          case 'wait_hint_received':
            if (verbose) {
              const txKey = event.data.wait_hint.tx_hash || event.data.wait_hint.tx_id || 'unknown';
              process.stderr.write(`[wait_hint] transaction ${txKey} pending\n`);
            }
            finish({ outcome: 'wait_hint', waitHint: event.data });
            break;

          case 'error':
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              reject(new Error(event.data.message));
            }
            break;

          case 'thinking':
            if (verbose) {
              process.stderr.write(`[thinking] ${event.data.summary}\n`);
            }
            break;

          case 'tool_use':
            if (verbose) {
              process.stderr.write(`[tool] ${event.data.name}(${JSON.stringify(event.data.args)})\n`);
            }
            break;

          case 'tool_result':
            if (verbose) {
              const result = event.data.result.length > 200
                ? event.data.result.substring(0, 200) + '...'
                : event.data.result;
              process.stderr.write(`[result] ${event.data.name} = ${result}\n`);
            }
            break;
        }
        return;
      }
    });

    ws.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${err.message}`));
      }
    });

    ws.on('close', (code: number) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error(`WebSocket closed unexpectedly (code: ${code})`));
      }
    });
  });
}

/**
 * Poll transaction status until confirmed, failed, or timeout.
 *
 * Routes to the correct API based on wait_hint.type:
 * - "ledger_transaction" → GET /api/ledger/v1/transactions/{tx_id}
 * - otherwise → GET /api/relayer/transaction/{tx_hash}?chainId=...
 */
async function pollTransaction(
  waitHint: WaitHintReceivedEvent['data']['wait_hint'],
  pollIntervalMs: number,
  timeoutMs: number,
  token: string,
  userId: string,
  verbose?: boolean,
): Promise<{ status: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  const isLedger = waitHint.type === 'ledger_transaction';
  const txKey = isLedger ? (waitHint.tx_id || waitHint.tx_hash) : (waitHint.tx_hash || waitHint.tx_id);
  const chainId = waitHint.chain_id || '';

  if (!txKey) {
    return { status: 'warning', error: 'No tx_hash or tx_id in wait_hint' };
  }

  while (Date.now() < deadline) {
    try {
      let url: string;
      if (isLedger) {
        url = `${config.sessionServiceUrl}/ledger/v1/transactions/${encodeURIComponent(txKey)}`;
      } else {
        url = `${config.relayerUrl}/transaction/${encodeURIComponent(txKey)}?chainId=${encodeURIComponent(chainId)}`;
      }

      const response = await request(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-User-Id': userId,
        },
      });

      if (response.statusCode === 200) {
        const data = (await response.body.json()) as Record<string, unknown>;

        if (isLedger) {
          // Ledger API returns { status: "completed" | "pending" | "failed", ... }
          const status = data.status as string;
          if (verbose) {
            process.stderr.write(`[poll] ledger ${txKey.substring(0, 16)}... status=${status}\n`);
          }
          if (status === 'completed') return { status: 'confirmed' };
          if (status === 'failed') return { status: 'failed', error: 'Ledger transaction failed' };
        } else {
          // Relayer API returns { status: "confirmed" | "pending" | "failed" | ... }
          const status = data.status as string;
          if (verbose) {
            process.stderr.write(`[poll] ${txKey.substring(0, 16)}... status=${status}\n`);
          }
          if (status === 'confirmed' || status === 'finalized') return { status: 'confirmed' };
          if (status === 'failed') return { status: 'failed', error: (data.error as string) || 'Transaction failed' };
        }
      } else {
        await response.body.text();
        if (verbose) {
          process.stderr.write(`[poll] ${isLedger ? 'ledger' : 'relayer'} returned ${response.statusCode}, retrying...\n`);
        }
      }
    } catch (err) {
      if (verbose) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[poll] error: ${msg}, retrying...\n`);
      }
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return { status: 'warning', error: 'Transaction status polling timeout' };
}

/**
 * POST /chat to initiate an agent run.
 */
async function postChat(
  sessionId: string,
  message: string,
  token: string,
  userId: string,
  timeoutMs: number,
): Promise<{ runId: string }> {
  const response = await request(config.chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-User-Id': userId,
    },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      options: {
        auto_approve_tools: config.autoApproveTools,
        timeout_ms: timeoutMs,
      },
    }),
  });

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    const body = await response.body.text();
    throw new Error(`POST /chat failed (${response.statusCode}): ${body}`);
  }

  const data = (await response.body.json()) as Record<string, string>;
  const runId = data.runId || data.run_id;
  if (!runId) {
    throw new Error(`POST /chat response missing runId: ${JSON.stringify(data)}`);
  }
  return { runId };
}

/**
 * Cancel an active run via the REST cancel endpoint.
 */
export async function cancelRun(sessionId: string, token: string, userId: string): Promise<void> {
  const response = await request(config.cancelUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-User-Id': userId,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (response.statusCode !== 200) {
    const body = await response.body.text();
    throw new Error(`Cancel failed (${response.statusCode}): ${body}`);
  }
}
