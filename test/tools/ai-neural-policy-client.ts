/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

interface PendingRequest {
  resolve: (scores: number[]) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface SidecarMessage {
  type?: string;
  id?: number;
  featureCount?: number;
  scores?: unknown;
  error?: string;
}

export class AiNeuralPolicyClient {
  private readonly modelDir: string;
  private readonly featureCount: number;
  private process: ChildProcessWithoutNullStreams | null = null;
  private lines: ReadlineInterface | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private readyTimeout: NodeJS.Timeout | null = null;
  private stderr = "";
  private stopping = false;

  constructor(modelDir: string, featureCount: number) {
    this.modelDir = modelDir;
    this.featureCount = featureCount;
  }

  start(): Promise<void> {
    if (this.readyPromise !== null) {
      return this.readyPromise;
    }
    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.resolveReady = resolveReady;
      this.rejectReady = rejectReady;
    });
    const python = process.env.ER_AI_PYTHON?.trim() || "python";
    this.process = spawn(
      python,
      [resolve("ml/policy/serve_candidate_transformer.py"), "--model-dir", resolve(this.modelDir)],
      { cwd: process.cwd(), windowsHide: true },
    );
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", chunk => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384);
    });
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on("line", line => this.handleLine(line));
    this.process.on("error", error => this.failAll(error));
    this.process.on("exit", (code, signal) => {
      if (!this.stopping) {
        this.failAll(
          new Error(
            `neural policy sidecar exited code=${String(code)} signal=${String(signal)} stderr=${this.stderr.trim()}`,
          ),
        );
      }
    });
    this.readyTimeout = setTimeout(() => {
      this.failAll(new Error(`neural policy sidecar did not become ready; stderr=${this.stderr.trim()}`));
    }, 30_000);
    return this.readyPromise;
  }

  async score(candidateFeatures: number[][]): Promise<number[]> {
    await this.start();
    if (!this.process || this.process.exitCode != null) {
      throw new Error("neural policy sidecar is not running");
    }
    const id = this.nextId++;
    return await new Promise<number[]>((resolveScores, rejectScores) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectScores(new Error(`neural policy request ${id} timed out`));
      }, 30_000);
      this.pending.set(id, { resolve: resolveScores, reject: rejectScores, timeout });
      this.process?.stdin.write(`${JSON.stringify({ id, candidateFeatures })}\n`);
    });
  }

  stop(): void {
    this.stopping = true;
    this.clearReadyTimeout();
    this.lines?.close();
    this.lines = null;
    if (this.process && this.process.exitCode == null) {
      this.process.stdin.end();
      this.process.kill();
    }
    this.process = null;
    this.rejectPending(new Error("neural policy sidecar stopped"));
  }

  private handleLine(line: string): void {
    let message: SidecarMessage;
    try {
      message = JSON.parse(line) as SidecarMessage;
    } catch {
      this.failAll(new Error(`neural policy sidecar emitted invalid JSON: ${line}`));
      return;
    }
    if (message.type === "ready") {
      if (message.featureCount !== this.featureCount) {
        this.failAll(
          new Error(`neural policy feature count mismatch: expected ${this.featureCount}, got ${message.featureCount}`),
        );
        return;
      }
      this.resolveReady?.();
      this.clearReadyTimeout();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (!Number.isInteger(message.id)) {
      this.failAll(new Error(`neural policy sidecar response has no integer id: ${line}`));
      return;
    }
    const request = this.pending.get(message.id!);
    if (!request) {
      this.failAll(new Error(`neural policy sidecar returned unknown request id ${message.id}`));
      return;
    }
    this.pending.delete(message.id!);
    clearTimeout(request.timeout);
    if (message.error) {
      request.reject(new Error(`neural policy request ${message.id} failed: ${message.error}`));
      return;
    }
    if (
      !Array.isArray(message.scores)
      || message.scores.length === 0
      || message.scores.some(score => typeof score !== "number" || !Number.isFinite(score))
    ) {
      request.reject(new Error(`neural policy request ${message.id} returned invalid scores`));
      return;
    }
    request.resolve(message.scores as number[]);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private failAll(error: Error): void {
    this.clearReadyTimeout();
    this.rejectReady?.(error);
    this.rejectReady = null;
    this.resolveReady = null;
    this.rejectPending(error);
    if (this.process && this.process.exitCode == null) {
      this.stopping = true;
      this.process.kill();
    }
  }

  private clearReadyTimeout(): void {
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
  }
}
