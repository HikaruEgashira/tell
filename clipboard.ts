/** 出力にフェンス付きコードブロックが含まれるか。含まれるときだけクリップボードへ送る。 */
export function shouldCopy(text: string): boolean {
  return text.includes("```");
}

/** macOS の pbcopy へテキストを流し込む。 */
export async function copyToClipboard(text: string): Promise<void> {
  const pbcopy = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  pbcopy.stdin.write(text);
  pbcopy.stdin.end();
  await pbcopy.exited;
}
