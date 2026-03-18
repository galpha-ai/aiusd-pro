import { request } from 'undici';
import { randomUUID } from 'crypto';
import { config } from './config.js';

export interface Session {
  id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  items: Session[];
  nextCursor?: string;
}

export class SessionManager {
  private baseUrl: string;
  private userId: string;
  private token: string;

  constructor(userId: string, token: string) {
    this.baseUrl = config.sessionServiceUrl;
    this.userId = userId;
    this.token = token;
  }

  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-User-Id': this.userId,
      'Authorization': `Bearer ${this.token}`,
      ...extra,
    };
  }

  async createSession(title?: string): Promise<Session> {
    const response = await request(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: this.getHeaders({ 'Idempotency-Key': randomUUID() }),
      body: JSON.stringify(title ? { title } : {}),
    });

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      const body = await response.body.text();
      throw new Error(`Failed to create session (${response.statusCode}): ${body}`);
    }

    return (await response.body.json()) as Session;
  }

  async createShare(sessionId: string): Promise<{ share_token: string; created_at: string }> {
    const response = await request(`${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/share`, {
      method: 'POST',
      headers: this.getHeaders({ 'Idempotency-Key': randomUUID() }),
    });

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      const body = await response.body.text();
      throw new Error(`Failed to create share (${response.statusCode}): ${body}`);
    }

    return (await response.body.json()) as { share_token: string; created_at: string };
  }

  async listSessions(limit: number = 20): Promise<SessionListResponse> {
    const params = new URLSearchParams({ pageSize: limit.toString() });
    const response = await request(`${this.baseUrl}/sessions?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.statusCode !== 200) {
      const body = await response.body.text();
      throw new Error(`Failed to list sessions (${response.statusCode}): ${body}`);
    }

    return (await response.body.json()) as SessionListResponse;
  }
}
