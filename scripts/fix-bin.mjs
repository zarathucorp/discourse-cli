import { fileURLToPath } from "node:url";
import { chmod, readFile, writeFile } from "node:fs/promises";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const shebang = "#!/usr/bin/env node\n";

async function main() {
  const source = await readFile(cliPath, "utf8");
  if (!source.startsWith(shebang)) {
    await writeFile(cliPath, `${shebang}${source}`, "utf8");
  }

  // Why: linked installs rely on executable bit outside local node invocation.
  await chmod(cliPath, 0o755);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
