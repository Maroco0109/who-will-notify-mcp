import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface HttpServerOptions {
  port: number;
  serviceName: string;
  version: string;
  instructions: string;
  /** 매 요청마다 새 McpServer 에 도구를 등록하는 콜백 (stateless). */
  register: (server: McpServer) => void;
  /** /health 에 덧붙일 상태(데이터층 새로고침 가시성 등). */
  health?: () => object;
}

// ── 인메모리 레이트리밋 (IP당 고정 윈도우) ──────────────────────────────────
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120);
const rateHits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateHits) if (v.resetAt <= now) rateHits.delete(k);
}, RATE_WINDOW_MS).unref();

function rateLimit(req: Request, res: Response, next: () => void): void {
  if (req.path === "/health") return next();
  const now = Date.now();
  const ip = req.ip ?? "unknown";
  let e = rateHits.get(ip);
  if (!e || e.resetAt <= now) {
    e = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateHits.set(ip, e);
  }
  e.count++;
  res.setHeader("X-RateLimit-Limit", String(RATE_MAX));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, RATE_MAX - e.count)));
  if (e.count > RATE_MAX) {
    res.setHeader("Retry-After", String(Math.ceil((e.resetAt - now) / 1000)));
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32029, message: "Rate limit exceeded. Try again later." },
      id: null,
    });
    return;
  }
  next();
}

/**
 * PlayMCP 직등록형 Streamable HTTP 서버.
 * - POST /mcp    : MCP 요청 (stateless — 요청마다 server+transport 생성)
 * - GET  /health : 헬스체크 + 데이터층 상태(PlayMCP 등록 점검·관측)
 */
export function startHttpServer(opts: HttpServerOptions): void {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(rateLimit);

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      service: opts.serviceName,
      ...(opts.health ? opts.health() : {}),
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = new McpServer(
        { name: opts.serviceName, version: opts.version },
        { instructions: opts.instructions },
      );
      opts.register(server);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless 모드
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[${opts.serviceName}] MCP request error:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // stateless: GET(SSE)/DELETE(세션 종료) 미지원
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(opts.port, () => {
    console.log(
      `[${opts.serviceName}] listening on :${opts.port}  (POST /mcp · GET /health)`,
    );
  });
}
