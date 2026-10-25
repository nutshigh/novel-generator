import { readdir, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GenerateRequest } from "../src/ai/gateway.js";
import {
  PiAiGateway,
  createPiGateway,
  createPiGatewayFromModelConfig,
  modelApiForProtocol,
  type PiGatewayConfig,
} from "../src/ai/piGateway.js";
import { createTempDir, removeTempDir } from "./temp.js";

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }),
  );
  return files.flat();
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock server did not bind to a TCP port.");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function openAiStream(text: string): string {
  const base = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "test-model",
  };
  const chunk = (delta: unknown, finishReason: string | null): string =>
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;

  return (
    chunk({ role: "assistant", content: text }, null) +
    chunk({}, "stop") +
    "data: [DONE]\n\n"
  );
}

function anthropicStream(text: string): string {
  const events: Array<[string, unknown]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
    ],
    [
      "content_block_stop",
      { type: "content_block_stop", index: 0 },
    ],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];

  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

describe("PiAiGateway", () => {
  it("constructs from gateway config without calling a model", () => {
    const root = createTempDir("novelbuilder-pi-");

    try {
      const config: PiGatewayConfig = {
        provider: "missing-provider",
        modelId: "missing-model",
        agentDir: join(root, "agent"),
      };

      expect(new PiAiGateway(config)).toBeInstanceOf(PiAiGateway);
    } finally {
      removeTempDir(root);
    }
  });

  it("fails clearly for an unknown model without calling a model", async () => {
    const root = createTempDir("novelbuilder-pi-");

    try {
      await expect(
        createPiGateway({
          provider: "missing-provider",
          modelId: "missing-model",
          agentDir: join(root, "agent"),
        }),
      ).rejects.toThrow(/Model not found: missing-provider\/missing-model/);
    } finally {
      removeTempDir(root);
    }
  }, 30_000);

  it("maps protocols to Pi API names", () => {
    expect(modelApiForProtocol("openai")).toBe("openai-completions");
    expect(modelApiForProtocol("anthropic")).toBe("anthropic-messages");
  });

  it("talks to an OpenAI-compatible mock endpoint and survives temp cleanup", async () => {
    const root = createTempDir("novelbuilder-pi-openai-");
    const agentDir = join(root, "agent");
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      body: string;
    }> = [];

    const server = createServer(async (req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: await readBody(req),
      });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.end(openAiStream("hello"));
    });

    const port = await listen(server);
    const request: GenerateRequest = {
      kind: "chapter",
      system: "test system",
      user: "test user",
    };

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "openai",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "test-model",
        apiKey: "test-key",
        agentDir,
      });

      await expect(readdir(join(agentDir, "runtime-models"))).resolves.toEqual([]);
      await expect(gateway.generateText(request)).resolves.toBe("hello");
      await expect(gateway.generateText(request)).resolves.toBe("hello");
    } finally {
      await closeServer(server);
      removeTempDir(root);
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("/v1/chat/completions");
    expect(requests[0]?.authorization).toBe("Bearer test-key");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      model: "test-model",
      stream: true,
    });
  }, 30_000);

  it("talks to an Anthropic mock endpoint with x-api-key", async () => {
    const root = createTempDir("novelbuilder-pi-anthropic-");
    const agentDir = join(root, "agent");
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      apiKey: string | undefined;
      body: string;
    }> = [];

    const server = createServer(async (req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        apiKey: req.headers["x-api-key"] as string | undefined,
        body: await readBody(req),
      });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.end(anthropicStream("hello"));
    });

    const port = await listen(server);

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "anthropic",
        baseUrl: `http://127.0.0.1:${port}`,
        model: "test-model",
        apiKey: "test-key",
        agentDir,
      });

      await expect(
        gateway.generateText({
          kind: "chapter",
          system: "test system",
          user: "test user",
        }),
      ).resolves.toBe("hello");
    } finally {
      await closeServer(server);
      removeTempDir(root);
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url?.split("?")[0]).toBe("/v1/messages");
    expect(requests[0]?.apiKey).toBe("test-key");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      model: "test-model",
      stream: true,
    });
  }, 30_000);

  it("rejects when the mock model endpoint returns an error", async () => {
    const root = createTempDir("novelbuilder-pi-error-");
    const agentDir = join(root, "agent");

    const server = createServer(async (req, res) => {
      await readBody(req);
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "invalid api key",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
      );
    });
    const port = await listen(server);

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "openai",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "test-model",
        apiKey: "test-key",
        agentDir,
      });

      await expect(
        gateway.generateText({
          kind: "chapter",
          system: "test system",
          user: "test user",
        }),
      ).rejects.toThrow(/invalid api key|401/i);
    } finally {
      await closeServer(server);
      removeTempDir(root);
    }
  }, 30_000);

  it("reports aborted model requests clearly", async () => {
    const root = createTempDir("novelbuilder-pi-abort-");
    const agentDir = join(root, "agent");

    const server = createServer(async (req, res) => {
      await readBody(req);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          created: 1_700_000_000,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "partial" },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      await new Promise<void>((resolve) => res.once("close", resolve));
    });
    const port = await listen(server);

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "openai",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "test-model",
        apiKey: "test-key",
        agentDir,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50);
      try {
        await expect(
          gateway.generateText({
            kind: "chapter",
            system: "test system",
            user: "test user",
            signal: controller.signal,
          }),
        ).rejects.toThrow(/aborted/i);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await closeServer(server);
      removeTempDir(root);
    }
  }, 30_000);

  it("rejects when a successful response contains no text", async () => {
    const root = createTempDir("novelbuilder-pi-empty-");
    const agentDir = join(root, "agent");

    const server = createServer(async (req, res) => {
      await readBody(req);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(openAiStream(""));
    });
    const port = await listen(server);

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "openai",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "test-model",
        apiKey: "test-key",
        agentDir,
      });

      await expect(
        gateway.generateText({
          kind: "chapter",
          system: "test system",
          user: "test user",
        }),
      ).rejects.toThrow("Model returned no text.");
    } finally {
      await closeServer(server);
      removeTempDir(root);
    }
  }, 30_000);

  it("builds an OpenAI-compatible gateway without a network call and cleans temp files", async () => {
    const root = createTempDir("novelbuilder-pi-config-");
    const agentDir = join(root, "agent");

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "openai",
        baseUrl: "https://example.com/v1/",
        model: "example-model",
        apiKey: "test-secret-key",
        agentDir,
      });

      expect(gateway).toBeInstanceOf(PiAiGateway);
      await expect(readdir(join(agentDir, "runtime-models"))).resolves.toEqual([]);

      for (const file of await listFiles(agentDir)) {
        const content = await readFile(file, "utf8");
        expect(content).not.toContain("test-secret-key");
      }
    } finally {
      removeTempDir(root);
    }
  }, 30_000);

  it("builds an Anthropic gateway without a network call", async () => {
    const root = createTempDir("novelbuilder-pi-config-");
    const agentDir = join(root, "agent");

    try {
      const gateway = await createPiGatewayFromModelConfig({
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-test",
        agentDir,
      });

      expect(gateway).toBeInstanceOf(PiAiGateway);
      await expect(readdir(join(agentDir, "runtime-models"))).resolves.toEqual([]);
    } finally {
      removeTempDir(root);
    }
  }, 30_000);

  it("rejects invalid model configs before creating a gateway", async () => {
    const root = createTempDir("novelbuilder-pi-config-");
    const agentDir = join(root, "agent");

    try {
      await expect(
        createPiGatewayFromModelConfig({
          protocol: "invalid" as never,
          baseUrl: "https://example.com/v1",
          model: "example-model",
          agentDir,
        }),
      ).rejects.toThrow(/protocol/);

      await expect(
        createPiGatewayFromModelConfig({
          protocol: "openai",
          baseUrl: "ftp://example.com/v1",
          model: "example-model",
          agentDir,
        }),
      ).rejects.toThrow(/http/);

      await expect(
        createPiGatewayFromModelConfig({
          protocol: "openai",
          baseUrl: "not a url",
          model: "example-model",
          agentDir,
        }),
      ).rejects.toThrow(/http/);

      await expect(
        createPiGatewayFromModelConfig({
          protocol: "openai",
          baseUrl: "",
          model: "example-model",
          agentDir,
        }),
      ).rejects.toThrow(/baseUrl/);

      await expect(
        createPiGatewayFromModelConfig({
          protocol: "openai",
          baseUrl: "https://example.com/v1",
          model: "   ",
          agentDir,
        }),
      ).rejects.toThrow(/model/);

      await expect(
        createPiGatewayFromModelConfig({
          protocol: "openai",
          baseUrl: "https://example.com/v1",
          model: "example-model",
          apiKey: 42 as never,
          agentDir,
        }),
      ).rejects.toThrow(/apiKey/);
    } finally {
      removeTempDir(root);
    }
  });
});
