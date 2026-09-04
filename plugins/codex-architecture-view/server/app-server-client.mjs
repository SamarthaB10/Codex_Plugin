import WebSocket from "ws";
import { spawn } from "node:child_process";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CodexAppServerClient {
  constructor(url = process.env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:4500") {
    this.url = url;
    this.socket = null;
    this.connecting = null;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationListeners = new Set();
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectWithManagedFallback().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async connectWithManagedFallback() {
    try {
      await this.openSocket();
      return;
    } catch {
      if (!this.managedProcess) {
        const url = new URL(this.url);
        this.managedProcess = spawn("codex", ["app-server", "--listen", `${url.protocol}//${url.host}`], {
          stdio: "ignore",
          env: process.env,
        });
        this.managedProcess.once("exit", () => { this.managedProcess = null; });
      }
    }
    let lastError = new Error("Codex app-server did not start");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(200);
      try {
        await this.openSocket();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : lastError;
      }
    }
    throw lastError;
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const fail = (error) => {
        socket.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      socket.once("error", fail);
      socket.once("open", async () => {
        socket.off("error", fail);
        this.socket = socket;
        this.connecting = null;
        socket.on("message", (value) => this.onMessage(String(value)));
        socket.on("close", () => this.onClose());
        socket.on("error", () => this.onClose());
        try {
          await this.request("initialize", {
            clientInfo: { name: "codex-architecture-view", title: "Codex Architecture View", version: "0.1.0" },
            capabilities: { experimentalApi: true, requestAttestation: false },
          });
          this.notify("initialized");
          resolve();
        } catch (error) {
          fail(error);
        }
      });
    });
  }

  onMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.id === undefined) {
      for (const listener of this.notificationListeners) listener(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || "Codex app-server request failed"));
    else pending.resolve(message.result);
  }

  onClose() {
    this.socket = null;
    for (const pending of this.pending.values()) pending.reject(new Error("Codex app-server disconnected"));
    this.pending.clear();
  }

  async request(method, params = {}) {
    if (method !== "initialize") await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Codex app-server is not connected");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method, params = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ method, params }));
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async listThreads() {
    const result = await this.request("thread/list", { limit: 50, sortKey: "updated_at", sortDirection: "desc" });
    return Array.isArray(result?.data) ? result.data : [];
  }

  async readThread(threadId) {
    const result = await this.request("thread/read", { threadId, includeTurns: true });
    if (!result?.thread) throw new Error(`Task ${threadId} was not found`);
    return result.thread;
  }

  async sendMessage(threadId, message) {
    await this.request("thread/resume", { threadId });
    const result = await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: message, text_elements: [] }],
    });
    return result?.turn?.id || null;
  }
}
