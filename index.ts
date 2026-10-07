import { copyToClipboard, shouldCopy } from "./clipboard";

/** bun build --define で埋め込まれるバージョン文字列。未定義時は dev */
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

// `tell` は Codex app-server の1ターンだけを回す非対話クライアント。
// 設定はここで固定し、環境差で挙動が変わらないようにする。
const MODEL = "gpt-6-astra";
const EFFORT = "low";
const SERVICE_TIER = "ultrafast";

type Json = any;

type Pending = {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
};

/** codex app-server を stdio で起動し、1プロンプトを投げて最終回答を返す。 */
async function ask(prompt: string): Promise<string> {
  const codex = Bun.which("codex");
  if (codex === null) {
    throw new Error("codex CLI が PATH にありません");
  }

  const proc = Bun.spawn([codex, "app-server"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const pending = new Map<number, Pending>();
  let nextId = 0;

  const request = (method: string, params?: Json): Promise<Json> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      proc.stdin.write(encoder.encode(JSON.stringify({ method, id, params }) + "\n"));
    });

  // itemId -> { phase, text }。最終回答だけを pbcopy 対象にするため phase を保持する。
  const items = new Map<string, { phase: string | null; text: string }>();
  let lastWritten = "";

  let finishTurn: (() => void) | undefined;
  let failTurn: ((error: Error) => void) | undefined;
  const turnDone = new Promise<void>((resolve, reject) => {
    finishTurn = resolve;
    failTurn = reject;
  });

  const pump = (async () => {
    const reader = proc.stdout.getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "") continue;

        let message: Json;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // app-server 以外の雑多な出力は無視する
        }

        if (message.id !== undefined && pending.has(message.id)) {
          const waiter = pending.get(message.id)!;
          pending.delete(message.id);
          if (message.error) {
            waiter.reject(new Error(`${message.method}: ${JSON.stringify(message.error)}`));
          } else {
            waiter.resolve(message.result);
          }
          continue;
        }

        switch (message.method) {
          case "item/agentMessage/delta": {
            const delta: string = message.params.delta;
            const item = items.get(message.params.itemId) ?? { phase: null, text: "" };
            item.text += delta;
            items.set(message.params.itemId, item);
            process.stdout.write(delta);
            lastWritten = delta;
            break;
          }
          case "item/completed": {
            const item = message.params.item;
            if (item?.type === "agentMessage") {
              const streamed = items.get(item.id);
              items.set(item.id, {
                phase: item.phase ?? null,
                text: item.text ?? streamed?.text ?? "",
              });
            }
            break;
          }
          case "turn/completed":
            if (message.params.turn.error) {
              failTurn?.(new Error(JSON.stringify(message.params.turn.error)));
            } else {
              finishTurn?.();
            }
            break;
          case "error":
            failTurn?.(new Error(message.params?.message ?? JSON.stringify(message.params)));
            break;
        }
      }
    }
  })();

  try {
    await request("initialize", {
      clientInfo: { name: "tell", title: "tell", version: VERSION },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    const thread = await request("thread/start", {
      model: MODEL,
      serviceTier: SERVICE_TIER,
      cwd: process.cwd(),
      approvalPolicy: "never",
      ephemeral: true,
    });
    await request("turn/start", {
      threadId: thread.thread.id,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      model: MODEL,
      effort: EFFORT,
      serviceTier: SERVICE_TIER,
    });
    await turnDone;
  } finally {
    proc.stdin.end();
    proc.kill();
    await pump.catch(() => {});
  }

  if (lastWritten !== "" && !lastWritten.endsWith("\n")) {
    process.stdout.write("\n");
  }

  const all = [...items.values()];
  const finals = all.filter((item) => item.phase === "final_answer");
  return (finals.length > 0 ? finals : all).map((item) => item.text).join("");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "version") {
    console.log(VERSION);
  } else if (args.length === 0) {
    console.error("Usage: tell <text>");
    console.error("       tell version");
    process.exit(1);
  } else {
    try {
      const text = await ask(args.join(" "));
      if (shouldCopy(text)) {
        await copyToClipboard(text);
        console.error("📋 copied to clipboard");
      }
    } catch (error) {
      console.error(`tell: ${(error as Error).message}`);
      process.exit(1);
    }
  }
}
