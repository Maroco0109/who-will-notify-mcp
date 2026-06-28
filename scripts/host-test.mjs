// ============================================================================
// host-test.mjs — 로컬 호스트 하니스
//   OpenAI(=PlayMCP 호스트 LLM 대역) ↔ 우리 MCP 서버 의 전체 루프를 재현한다.
//
//   1) 다른 터미널에서 서버:  npm run dev   (기본 :3000)
//   2) 배선 점검만(키 불필요): node scripts/host-test.mjs
//      실제 대화:              OPENAI_API_KEY=sk-... node scripts/host-test.mjs "1학년은 어떤 과목 들을 수 있어?"
//   환경변수: PORT(기본 3000), OPENAI_MODEL(기본 gpt-4o-mini)
// ============================================================================
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = process.env.PORT ?? "3000";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const mcp = new Client({ name: "notify-host-test", version: "0.0.0" });
try {
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`)),
  );
} catch (e) {
  console.error(
    `✗ MCP 서버(:${PORT}) 연결 실패. 먼저 'npm run dev' 로 서버를 띄웠는지 확인하세요.\n  ${e.message}`,
  );
  process.exit(1);
}

const instructions =
  (typeof mcp.getInstructions === "function" ? mcp.getInstructions() : "") ?? "";
const { tools } = await mcp.listTools();
console.log(
  `✓ MCP 연결됨 (:${PORT}) — 도구 ${tools.length}개: ${tools.map((t) => t.name).join(", ")}`,
);
console.log(
  `✓ instructions ${instructions.length}자 수신${instructions ? "" : " — 비어있음!"}`,
);

if (!process.env.OPENAI_API_KEY) {
  console.log("\nℹ️  OPENAI_API_KEY 없음 — MCP 배선 점검만 완료 (LLM 호출 생략).");
  console.log(
    '   실제 대화: OPENAI_API_KEY=sk-... node scripts/host-test.mjs "1학년은 어떤 과목 들을 수 있어?"',
  );
  await mcp.close();
  process.exit(0);
}

const oaTools = tools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description ?? "",
    parameters: t.inputSchema ?? { type: "object", properties: {} },
  },
}));

const { default: OpenAI } = await import("openai");
const openai = new OpenAI();
const messages = [
  { role: "system", content: instructions || "학과 공지 안내 어시스턴트." },
];

async function runTurn(userText) {
  messages.push({ role: "user", content: userText });
  console.log(`\n👤 학생: ${userText}`);
  for (let hop = 0; hop < 6; hop++) {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: oaTools,
    });
    const msg = res.choices[0].message;
    messages.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {}
        console.log(`🛠️  ${tc.function.name}(${JSON.stringify(args)})`);
        let resultText;
        try {
          const r = await mcp.callTool({
            name: tc.function.name,
            arguments: args,
          });
          resultText = (r.content ?? []).map((c) => c.text ?? "").join("\n");
        } catch (e) {
          resultText = `ERROR: ${e.message}`;
        }
        console.log(
          `   ↳ ${resultText.slice(0, 400)}${resultText.length > 400 ? "…" : ""}`,
        );
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultText,
        });
      }
      continue;
    }
    console.log(`\n🤖 안내: ${msg.content}`);
    return;
  }
  console.log("⚠️  tool 호출이 6홉을 넘겨 중단.");
}

const argText = process.argv.slice(2).join(" ").trim();
if (argText) {
  await runTurn(argText);
  await mcp.close();
  process.exit(0);
}

console.log(`\n💬 대화형 모드 (model=${MODEL}). 질문 입력 (exit 종료).`);
const rl = readline.createInterface({ input, output });
while (true) {
  const line = (await rl.question("\n학생> ")).trim();
  if (!line) continue;
  if (line === "exit" || line === "quit") break;
  try {
    await runTurn(line);
  } catch (e) {
    console.error("turn error:", e.message);
  }
}
rl.close();
await mcp.close();
