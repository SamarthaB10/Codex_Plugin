import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const MAX_BODY_BYTES = 32_000;

function json(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export class LiveViewServer {
  constructor({ client, htmlPath, listTasks, readState, sendMessage }) {
    this.client = client;
    this.htmlPath = htmlPath;
    this.listTasks = listTasks;
    this.readState = readState;
    this.sendMessage = sendMessage;
    this.streams = new Map();
    this.pendingBroadcast = null;
    this.server = createServer((request, response) => this.handle(request, response));
    this.unsubscribe = client.onNotification(() => this.scheduleBroadcast());
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    this.keepAlive = setInterval(() => {
      for (const responses of this.streams.values()) {
        for (const response of responses) response.write(": keep-alive\n\n");
      }
    }, 15_000);
    this.keepAlive.unref();
  }

  viewerUrl(threadId) {
    const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
    return `http://127.0.0.1:${this.port}/${query}`;
  }

  async close() {
    clearInterval(this.keepAlive);
    clearTimeout(this.pendingBroadcast);
    this.unsubscribe();
    for (const responses of this.streams.values()) {
      for (const response of responses) response.end();
    }
    await new Promise((resolve) => this.server.close(resolve));
  }

  scheduleBroadcast() {
    clearTimeout(this.pendingBroadcast);
    this.pendingBroadcast = setTimeout(() => this.broadcastAll(), 120);
  }

  async broadcastAll() {
    await Promise.all([...this.streams.keys()].map((threadId) => this.broadcast(threadId)));
  }

  async broadcast(threadId) {
    const responses = this.streams.get(threadId);
    if (!responses?.size) return;
    try {
      const state = await this.readState(threadId);
      const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
      for (const response of responses) response.write(payload);
    } catch (error) {
      const payload = `event: service-error\ndata: ${JSON.stringify({ message: error.message })}\n\n`;
      for (const response of responses) response.write(payload);
    }
  }

  async handle(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(await readFile(this.htmlPath, "utf8"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        json(response, 200, { tasks: await this.listTasks() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        json(response, 200, await this.readState(url.searchParams.get("threadId") || undefined));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/message") {
        const body = await readJson(request);
        json(response, 200, await this.sendMessage(body.threadId, body.message));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          json(response, 400, { error: "threadId is required" });
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
        });
        response.write("retry: 1000\n\n");
        const responses = this.streams.get(threadId) || new Set();
        responses.add(response);
        this.streams.set(threadId, responses);
        request.once("close", () => {
          responses.delete(response);
          if (!responses.size) this.streams.delete(threadId);
        });
        await this.broadcast(threadId);
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : "Live service failed" });
    }
  }
}
