import { build } from "esbuild"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const output = new URL("./generated/local-test-worker.ts", import.meta.url)
const result = await build({
  entryPoints: [fileURLToPath(new URL("./publicApiLocalTestWorker.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  write: false,
  sourcemap: false,
  legalComments: "none",
})
// Embed the isolated evaluator in the server bundle: Wasp does not emit an
// additional worker file referenced only through new URL(..., import.meta.url).
const content = `// Generated during dependency installation.\nexport const localTestWorkerSource = ${JSON.stringify(result.outputFiles[0].text)}\n`
await mkdir(new URL("./generated/", import.meta.url), { recursive: true })
let previous
try { previous = await readFile(output, "utf8") } catch (error) {
  if (error.code !== "ENOENT") throw error
}
if (previous !== content) await writeFile(output, content)
