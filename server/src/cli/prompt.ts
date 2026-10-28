/**
 * Reads a line from the terminal without echoing it. Requires an interactive
 * TTY so passwords never come from arguments, environment variables or pipes.
 */
export function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return Promise.reject(
      new Error("ต้องรันคำสั่งนี้ใน terminal แบบโต้ตอบ (TTY) เพื่อพิมพ์รหัสผ่านแบบซ่อน"),
    );
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === "\u0003" || ch === "\u0004") {
          cleanup();
          reject(new Error("ยกเลิกแล้ว"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = [...value].slice(0, -1).join("");
          continue;
        }
        if (ch < " ") continue;
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function parseArgs(argv: string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
    if (inline !== undefined) args.set(key, inline);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) args.set(key, argv[++i]!);
    else args.set(key, true);
  }
  return args;
}
