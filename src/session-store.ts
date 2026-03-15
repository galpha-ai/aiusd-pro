import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

export function getCurrentSession(): string | null {
  try {
    return readFileSync(config.currentSessionPath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function setCurrentSession(sessionId: string): void {
  mkdirSync(dirname(config.currentSessionPath), { recursive: true });
  writeFileSync(config.currentSessionPath, sessionId, 'utf-8');
}

