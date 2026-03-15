import { Command } from 'commander';
import { TokenManager } from './token-manager.js';
import { sendMessage, cancelRun } from './agent-client.js';
import { SessionManager } from './session-manager.js';
import { getCurrentSession, setCurrentSession } from './session-store.js';
import { config } from './config.js';
import { unlinkSync } from 'fs';

function extractUserId(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT token');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (!payload.sub) throw new Error('JWT missing sub claim');
  return payload.sub;
}

function stripBearer(token: string): string {
  return token.startsWith('Bearer ') ? token.slice(7) : token;
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('aiusd-nl')
    .description('AIUSD Natural Language Agent CLI')
    .version('0.1.0');

  // -- send --
  program
    .command('send')
    .description('Send a natural language message to the AIUSD agent')
    .argument('<message>', 'Message to send')
    .option('-s, --session <id>', 'Session ID (default: use stored session)')
    .option('-v, --verbose', 'Show thinking and tool use events')
    .option('--timeout <ms>', 'Timeout in milliseconds', String(config.timeoutMs))
    .action(async (message: string, opts: { session?: string; verbose?: boolean; timeout?: string }) => {
      // 1. Get token
      const bearerToken = await TokenManager.ensureToken();
      if (!bearerToken) {
        process.stderr.write('Not logged in. Run: aiusd-nl login --browser\n');
        process.exit(1);
      }

      const rawToken = stripBearer(bearerToken);
      const userId = extractUserId(rawToken);

      // 2. Get or create session
      let sessionId = opts.session || getCurrentSession();
      if (!sessionId) {
        const mgr = new SessionManager(userId, rawToken);
        const session = await mgr.createSession('aiusd-nl');
        sessionId = session.id;
        setCurrentSession(sessionId);
      }

      const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : undefined;

      // 3. Send message
      try {
        await sendMessage({
          sessionId,
          message,
          token: rawToken,
          userId,
          verbose: opts.verbose,
          timeoutMs,
        });
        process.stdout.write(`\nContinue this conversation in your browser: https://aiusd.ai/chat/${sessionId}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Auto-recover from expired/invalid session
        if (msg.includes('returned 403') && !opts.session) {
          process.stderr.write('Session expired, creating new session...\n');
          const mgr = new SessionManager(userId, rawToken);
          const newSession = await mgr.createSession('aiusd-nl');
          sessionId = newSession.id;
          setCurrentSession(sessionId);
          try {
            await sendMessage({
              sessionId,
              message,
              token: rawToken,
              userId,
              verbose: opts.verbose,
              timeoutMs,
            });
            return;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            process.stderr.write(`Error: ${retryMsg}\n`);
            process.exit(1);
          }
        }

        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });

  // -- login --
  program
    .command('login')
    .description('Authenticate with AIUSD')
    .option('--browser', 'Start browser login flow')
    .option('--poll-session <id>', 'Poll for browser login completion')
    .option('--new-wallet', 'Create a new wallet and authenticate')
    .action(async (opts: { browser?: boolean; pollSession?: string; newWallet?: boolean }) => {
      if (opts.browser) {
        const session = await TokenManager.createAgentSession();
        if (!session) {
          process.stderr.write('Failed to create auth session\n');
          process.exit(1);
        }
        await TokenManager.savePendingSession({
          session_id: session.session_id,
          expires_at: session.expires_at,
        });
        console.log(JSON.stringify({
          url: `${config.agentAuthUrl}?sid=${session.session_id}`,
          session_id: session.session_id,
        }));
      } else if (opts.pollSession) {
        const pending = await TokenManager.readPendingSession();
        const expiresAt = pending?.expires_at || new Date(Date.now() + 5 * 60_000).toISOString();
        const tokens = await TokenManager.pollAgentSession(opts.pollSession, expiresAt);
        if (tokens) {
          await TokenManager.clearPendingSession();
          console.log('Login successful');
        } else {
          process.stderr.write('Login timed out or failed\n');
          process.exit(1);
        }
      } else if (opts.newWallet) {
        const result = await TokenManager.createNewWallet();
        console.log(JSON.stringify({
          auth_event: {
            type: 'new_wallet',
            address: result.address,
          },
        }));
      } else {
        process.stderr.write('Usage: aiusd-nl login --browser | --poll-session <id> | --new-wallet\n');
        process.exit(1);
      }
    });

  // -- logout --
  program
    .command('logout')
    .description('Remove stored authentication token')
    .action(() => {
      try {
        unlinkSync(config.tokenPath);
        console.log('Logged out');
      } catch {
        console.log('Already logged out');
      }
    });

  // -- session --
  const session = program
    .command('session')
    .description('Manage agent sessions');

  session
    .command('new')
    .description('Create a new session')
    .option('--title <title>', 'Session title')
    .action(async (opts: { title?: string }) => {
      const bearerToken = await TokenManager.ensureToken();
      if (!bearerToken) {
        process.stderr.write('Not logged in. Run: aiusd-nl login --browser\n');
        process.exit(1);
      }
      const rawToken = stripBearer(bearerToken);
      const userId = extractUserId(rawToken);
      const mgr = new SessionManager(userId, rawToken);
      const s = await mgr.createSession(opts.title || 'aiusd-nl');
      setCurrentSession(s.id);
      console.log(`Session created: ${s.id}`);
    });

  session
    .command('list')
    .description('List sessions')
    .option('--limit <n>', 'Max sessions to show', '10')
    .action(async (opts: { limit: string }) => {
      const bearerToken = await TokenManager.ensureToken();
      if (!bearerToken) {
        process.stderr.write('Not logged in. Run: aiusd-nl login --browser\n');
        process.exit(1);
      }
      const rawToken = stripBearer(bearerToken);
      const userId = extractUserId(rawToken);
      const mgr = new SessionManager(userId, rawToken);
      const result = await mgr.listSessions(parseInt(opts.limit, 10));
      const current = getCurrentSession();
      for (const s of result.items) {
        const marker = s.id === current ? ' (current)' : '';
        console.log(`${s.id}  ${s.title || '(untitled)'}  ${s.created_at}${marker}`);
      }
      if (result.items.length === 0) {
        console.log('No sessions found');
      }
    });

  session
    .command('reset')
    .description('Create a new session and set as current')
    .action(async () => {
      const bearerToken = await TokenManager.ensureToken();
      if (!bearerToken) {
        process.stderr.write('Not logged in. Run: aiusd-nl login --browser\n');
        process.exit(1);
      }
      const rawToken = stripBearer(bearerToken);
      const userId = extractUserId(rawToken);
      const mgr = new SessionManager(userId, rawToken);
      const s = await mgr.createSession('aiusd-nl');
      setCurrentSession(s.id);
      console.log(`New session: ${s.id}`);
    });

  // -- cancel --
  program
    .command('cancel')
    .description('Cancel the active agent run')
    .action(async () => {
      const bearerToken = await TokenManager.ensureToken();
      if (!bearerToken) {
        process.stderr.write('Not logged in. Run: aiusd-nl login --browser\n');
        process.exit(1);
      }
      const sessionId = getCurrentSession();
      if (!sessionId) {
        process.stderr.write('No active session\n');
        process.exit(1);
      }
      const rawToken = stripBearer(bearerToken);
      const userId = extractUserId(rawToken);
      await cancelRun(sessionId, rawToken, userId);
      console.log('Cancel requested');
    });

  return program;
}
