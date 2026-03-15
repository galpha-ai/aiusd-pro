import { homedir } from 'os';
import { join } from 'path';

export const config = {
  // Production endpoints (from galpha-infra Envoy routing)
  wsUrl: process.env.AIUSD_NL_WS_URL || 'wss://production.alpha.dev/api/ws-pusher/stream',
  chatUrl: process.env.AIUSD_NL_CHAT_URL || 'https://production.alpha.dev/api/chat',
  sessionServiceUrl: process.env.AIUSD_NL_SESSION_URL || 'https://production.alpha.dev/api',
  cancelUrl: process.env.AIUSD_NL_CANCEL_URL || 'https://production.alpha.dev/api/chat/cancel',
  userServiceUrl: process.env.AIUSD_NL_USER_SERVICE_URL || 'https://production.alpha.dev/api/user-service',
  relayerUrl: process.env.AIUSD_NL_RELAYER_URL || 'https://production.alpha.dev/api/relayer',
  agentAuthUrl: 'https://aiusd.ai/agent-auth',

  // Shared auth storage (with aiusd-skills)
  tokenPath: join(homedir(), '.aiusd', 'token.json'),
  mnemonicPath: join(homedir(), '.aiusd', 'AIUSD_WALLET_DO_NOT_DELETE'),
  pendingSessionPath: join(homedir(), '.aiusd', 'pending-session.json'),

  // NL skill local storage
  nlDir: join(homedir(), '.aiusd-nl'),
  currentSessionPath: join(homedir(), '.aiusd-nl', 'current-session'),

  // Defaults
  timeoutMs: 300_000,  // 5 min (agent-worker allows up to 10 min for tool-heavy ops)
  autoApproveTools: true,
};
