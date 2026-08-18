import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();

function initialState() {
  return {
    version: 4,
    settings: { defaultConcurrency: 4, defaultTimeoutMs: 60000, passScore: 8, reviewScore: 6.5, retentionDays: 90 },
    connections: [],
    datasets: [],
    evaluations: [],
  };
}

export class JsonStore {
  constructor(filePath) { this.filePath = filePath; this.state = null; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try { this.state = JSON.parse(await readFile(this.filePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; this.state = initialState(); await this.persist(); }
    const demo = this.state.connections.find((item) => item.id === "connection-mock");
    if (demo) {
      const mockModels = ["mock-balanced", "mock-fast", "mock-safe", "mock-precise", "mock-creative", "mock-compact", "mock-reasoning", "mock-guard"];
      demo.models = [...new Set([...(demo.models || []), ...mockModels])];
    }
    this.state.connections = (this.state.connections || []).map((connection) => ({ modelType: "text", ...connection }));
    this.state.settings = {
      defaultConcurrency: 4,
      defaultTimeoutMs: 60000,
      passScore: 8,
      reviewScore: 6.5,
      retentionDays: 90,
      ...(this.state.settings || {}),
    };
    this.state.evaluations = (this.state.evaluations || []).map((evaluation) => ({
      modelType: "text",
      comparisonMode: "optimized",
      repeatCount: 1,
      blindComparisons: [],
      modelSummaries: [],
      reviews: [],
      results: [],
      ...evaluation,
    }));
    this.state.version = 4;
    return this;
  }
  snapshot() { return structuredClone(this.state); }
  async mutate(mutator) {
    const operation = this.queue.catch(() => {}).then(async () => { const result = await mutator(this.state); await this.persist(); return result; });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async persist() { const temp = `${this.filePath}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 }); await rename(temp, this.filePath); }
}

export function publicConnection(connection) {
  const { encryptedApiKey, ...safe } = connection;
  return { ...safe, hasApiKey: Boolean(encryptedApiKey), keySuffix: connection.keySuffix || null };
}
