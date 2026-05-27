import { randomUUID } from "node:crypto";

import { MemorySession } from "@openai/agents";

export type ConversationSession = {
  sessionId: string;
  session: MemorySession;
  createdAt: Date;
  expiresAt: Date;
};

export class SessionStore {
  private readonly sessions = new Map<string, ConversationSession>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(): ConversationSession {
    this.pruneExpired();
    const createdAt = this.now();
    const sessionId = randomUUID();
    const value = {
      sessionId,
      session: new MemorySession({ sessionId }),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.ttlMs),
    };
    this.sessions.set(sessionId, value);
    return value;
  }

  get(sessionId: string): ConversationSession | undefined {
    const value = this.sessions.get(sessionId);
    if (!value) {
      return undefined;
    }
    const currentTime = this.now();
    if (value.expiresAt.getTime() <= currentTime.getTime()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    value.expiresAt = new Date(currentTime.getTime() + this.ttlMs);
    return value;
  }

  private pruneExpired(): void {
    const currentTime = this.now().getTime();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= currentTime) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
