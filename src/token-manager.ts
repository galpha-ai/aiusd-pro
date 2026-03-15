/**
 * Token Manager - Handles authentication token lifecycle
 *
 * Supports:
 * - Token retrieval from CLI arg, env vars, or file
 * - JWT refresh via refresh token
 * - Recovery from stored mnemonic (challenge/verify flow)
 * - Agent session creation and polling
 *
 * Storage paths configured via ./config.js
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { config } from './config.js';

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  timestamp: number;
}

export interface PendingSession {
  session_id: string;
  expires_at: string;
}

export type AuthMethod = 'new-wallet' | 'existing-wallet' | 'mnemonic-restore';

export class TokenManager {
  /**
   * Simple token retrieval with no side effects.
   * Priority: CLI arg -> env var (AIUSD_TOKEN) -> file (if not expired).
   * Returns normalized "Bearer xxx" or null.
   */
  static async getToken(cliToken?: string): Promise<string | null> {
    // 1. CLI argument
    if (cliToken) {
      return this.normalizeToken(cliToken);
    }

    // 2. Environment variables
    const envToken = process.env.AIUSD_TOKEN;
    if (envToken) {
      return this.normalizeToken(envToken);
    }

    // 3. Token file (only if not expired)
    const stored = await this.readStoredTokens();
    if (stored && !this.isExpired(stored)) {
      return this.normalizeToken(stored.access_token);
    }

    return null;
  }

  /**
   * Main entry point for obtaining a valid token.
   * Tries: getToken() -> refreshAccessToken() -> recoverFromMnemonic() -> null.
   * When null is returned, the caller should handle first-time auth.
   */
  static async ensureToken(cliToken?: string): Promise<string | null> {
    // Try simple retrieval first
    const token = await this.getToken(cliToken);
    if (token) {
      return token;
    }

    // Try refresh if we have a refresh token
    const stored = await this.readStoredTokens();
    if (stored?.refresh_token) {
      const refreshed = await this.refreshAccessToken(stored.refresh_token);
      if (refreshed) {
        return this.normalizeToken(refreshed.access_token);
      }
    }

    // Try mnemonic recovery
    const recovered = await this.recoverFromMnemonic();
    if (recovered) {
      return this.normalizeToken(recovered.access_token);
    }

    // Try pending browser session (one-shot check, not polling)
    const pending = await this.readPendingSession();
    if (pending) {
      const tokens = await this.checkAgentSession(pending.session_id);
      if (tokens) {
        await this.clearPendingSession();
        return this.normalizeToken(tokens.access_token);
      }
    }

    // Caller must handle first-time auth
    return null;
  }

  /**
   * Refresh the access token using a refresh token.
   * POST /auth/refresh with the refresh token.
   * Saves and returns new tokens on success, null on failure.
   */
  static async refreshAccessToken(refreshToken: string): Promise<StoredTokens | null> {
    try {
      const response = await fetch(`${config.userServiceUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        return null;
      }

      const json = await response.json() as {
        success: boolean;
        data: { access_token: string; refresh_token: string; expires_in: number };
      };
      if (!json.success || !json.data) {
        return null;
      }

      const tokens: StoredTokens = {
        access_token: json.data.access_token,
        refresh_token: json.data.refresh_token,
        expires_in: json.data.expires_in,
        timestamp: Math.floor(Date.now() / 1000),
      };

      await this.saveTokens(tokens);
      return tokens;
    } catch {
      return null;
    }
  }

  /**
   * Recover authentication from a stored mnemonic.
   * Reads the mnemonic file, creates an ethers Wallet, and runs challengeVerify().
   */
  static async recoverFromMnemonic(): Promise<StoredTokens | null> {
    try {
      const mnemonic = await this.readMnemonic();
      if (!mnemonic) {
        return null;
      }

      const { Wallet } = await import('ethers');
      const wallet = Wallet.fromPhrase(mnemonic.trim());
      return await this.challengeVerify(wallet);
    } catch {
      return null;
    }
  }

  /**
   * Full challenge/verify authentication flow.
   * POST challenge -> sign message -> POST verify.
   * Hex signature is converted to base64 before sending.
   * Saves and returns tokens on success.
   */
  static async challengeVerify(wallet: { address: string; signMessage: (message: string) => Promise<string> }): Promise<StoredTokens | null> {
    try {
      const address = wallet.address.toLowerCase();

      // Step 1: Request challenge
      const challengeRes = await fetch(`${config.userServiceUrl}/v1/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'aiusd.ai', chain_id: 'eip155:1', address }),
      });

      if (!challengeRes.ok) {
        return null;
      }

      const challengeData = await challengeRes.json() as {
        success: boolean;
        data: { challenge_id: string; message: string };
      };
      if (!challengeData.success || !challengeData.data) {
        return null;
      }

      const { challenge_id, message } = challengeData.data;

      // Step 2: Sign the challenge message
      const hexSignature = await wallet.signMessage(message);

      // Step 3: Convert hex signature to base64
      const hexClean = hexSignature.startsWith('0x') ? hexSignature.slice(2) : hexSignature;
      const bytes = Buffer.from(hexClean, 'hex');
      const base64Signature = bytes.toString('base64');

      // Step 4: Verify signature
      const verifyRes = await fetch(`${config.userServiceUrl}/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id, signature: base64Signature, domain: 'agent' }),
      });

      if (!verifyRes.ok) {
        return null;
      }

      const verifyData = await verifyRes.json() as {
        success: boolean;
        data: { access_token: string; refresh_token: string; expires_in: number };
      };
      if (!verifyData.success || !verifyData.data?.access_token) {
        return null;
      }

      const tokens: StoredTokens = {
        access_token: verifyData.data.access_token,
        refresh_token: verifyData.data.refresh_token || '',
        expires_in: verifyData.data.expires_in || 86400,
        timestamp: Math.floor(Date.now() / 1000),
      };

      await this.saveTokens(tokens);
      return tokens;
    } catch {
      return null;
    }
  }

  /**
   * Create a new wallet, authenticate, and save mnemonic + tokens.
   * Returns wallet address and tokens.
   */
  static async createNewWallet(): Promise<{ mnemonic: string; address: string; tokens: StoredTokens }> {
    const { Wallet } = await import('ethers');
    const wallet = Wallet.createRandom();
    const mnemonic = wallet.mnemonic?.phrase;
    if (!mnemonic) {
      throw new Error('Failed to generate mnemonic');
    }
    await this.saveMnemonic(mnemonic);
    const tokens = await this.challengeVerify(wallet);
    if (!tokens) {
      throw new Error('Authentication failed for new wallet');
    }
    return { mnemonic, address: wallet.address, tokens };
  }

  /**
   * Create a new agent session for browser-based authentication.
   * POST /auth/agent-session.
   */
  static async createAgentSession(): Promise<{ session_id: string; expires_at: string } | null> {
    try {
      const response = await fetch(`${config.userServiceUrl}/v1/auth/agent-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return null;
      }

      const json = await response.json() as {
        success: boolean;
        data: { session_id: string; expires_at: string };
      };
      if (!json.success || !json.data) return null;
      return { session_id: json.data.session_id, expires_at: json.data.expires_at };
    } catch {
      return null;
    }
  }

  /**
   * Poll an agent session until it is completed or expired.
   * GET /agent-session/{sessionId} every 2 seconds.
   */
  static async pollAgentSession(
    sessionId: string,
    expiresAt?: string,
  ): Promise<StoredTokens | null> {
    const expiresTime = expiresAt ? new Date(expiresAt).getTime() : Date.now() + 5 * 60 * 1000;

    while (Date.now() < expiresTime) {
      try {
        const response = await fetch(`${config.userServiceUrl}/v1/auth/agent-session/${sessionId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const json = await response.json() as {
            success: boolean;
            data: {
              status: string;
              access_token?: string;
              refresh_token?: string;
              expires_in?: number;
            };
          };
          const data = json.data;

          if (data?.status === 'completed' && data.access_token && data.refresh_token && data.expires_in) {
            const tokens: StoredTokens = {
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expires_in: data.expires_in,
              timestamp: Math.floor(Date.now() / 1000),
            };

            await this.saveTokens(tokens);
            return tokens;
          }
        }
      } catch {
        // Network error, continue polling
      }

      // Wait 2 seconds before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return null;
  }

  /**
   * Single check of an agent session (no polling).
   * Returns tokens if session is completed, null otherwise.
   */
  static async checkAgentSession(sessionId: string): Promise<StoredTokens | null> {
    try {
      const response = await fetch(`${config.userServiceUrl}/v1/auth/agent-session/${sessionId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) return null;

      const json = await response.json() as {
        success: boolean;
        data: {
          status: string;
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
      };
      const data = json.data;

      if (data?.status === 'completed' && data.access_token && data.refresh_token && data.expires_in) {
        const tokens: StoredTokens = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          timestamp: Math.floor(Date.now() / 1000),
        };
        await this.saveTokens(tokens);
        return tokens;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save a pending browser login session.
   */
  static async savePendingSession(session: PendingSession): Promise<void> {
    await mkdir(dirname(config.pendingSessionPath), { recursive: true });
    await writeFile(config.pendingSessionPath, JSON.stringify(session), { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Read a pending session if it exists and hasn't expired.
   */
  static async readPendingSession(): Promise<PendingSession | null> {
    try {
      await access(config.pendingSessionPath);
      const content = await readFile(config.pendingSessionPath, 'utf8');
      const session = JSON.parse(content) as PendingSession;
      if (session.session_id && session.expires_at) {
        if (new Date(session.expires_at).getTime() > Date.now()) {
          return session;
        }
      }
      // Expired, clean up
      await this.clearPendingSession();
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Remove the pending session file.
   */
  static async clearPendingSession(): Promise<void> {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(config.pendingSessionPath);
    } catch {
      // File doesn't exist, ignore
    }
  }

  /**
   * Save a mnemonic phrase to the mnemonic file.
   */
  static async saveMnemonic(mnemonic: string): Promise<void> {
    await mkdir(dirname(config.mnemonicPath), { recursive: true });
    await writeFile(config.mnemonicPath, mnemonic, { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Read the stored mnemonic phrase from the mnemonic file.
   */
  static async readMnemonic(): Promise<string | null> {
    try {
      await access(config.mnemonicPath);
      const content = await readFile(config.mnemonicPath, 'utf8');
      const trimmed = content.trim();
      return trimmed || null;
    } catch {
      return null;
    }
  }

  /**
   * Read stored tokens from token.json.
   */
  static async readStoredTokens(): Promise<StoredTokens | null> {
    try {
      await access(config.tokenPath);
      const content = await readFile(config.tokenPath, 'utf8');
      const data = JSON.parse(content) as StoredTokens;
      if (data.access_token && data.refresh_token && data.expires_in && data.timestamp) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save tokens to token.json.
   */
  static async saveTokens(tokens: StoredTokens): Promise<void> {
    await mkdir(dirname(config.tokenPath), { recursive: true });
    await writeFile(config.tokenPath, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Check if stored tokens are expired.
   * Compares timestamp + expires_in against the current time.
   */
  static isExpired(tokens: StoredTokens): boolean {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds >= tokens.timestamp + tokens.expires_in;
  }

  /**
   * Ensure a token string has the "Bearer " prefix.
   */
  static normalizeToken(token: string): string {
    if (token.startsWith('Bearer ')) {
      return token;
    }
    return `Bearer ${token}`;
  }

  /**
   * Validate that a token has the Bearer prefix and looks like a 3-part JWT.
   */
  static validateToken(token: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }

    if (!token.startsWith('Bearer ')) {
      return false;
    }

    const jwtPart = token.substring(7);
    const parts = jwtPart.split('.');
    return parts.length === 3;
  }

  /**
   * The URL users should visit for agent-based browser authentication.
   */
  static get AGENT_AUTH_URL(): string {
    return config.agentAuthUrl;
  }

  /**
   * The path to the mnemonic file.
   */
  static get MNEMONIC_FILE_PATH(): string {
    return config.mnemonicPath;
  }
}
