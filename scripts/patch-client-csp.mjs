#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const caddyfilePath = resolve(process.cwd(), process.env.CADDYFILE_PATH ?? ".wasp/out/web-app/build/Caddyfile")
const workerDirective = "worker-src 'self' blob: data:"

if (!existsSync(caddyfilePath)) {
  console.error(`Client Caddyfile not found: ${caddyfilePath}`)
  process.exit(1)
}

const content = readFileSync(caddyfilePath, "utf8")
const policyMatch = content.match(/Content-Security-Policy\s+"([^"]*)"/)

if (!policyMatch) {
  console.error(`Content-Security-Policy header not found in ${caddyfilePath}`)
  process.exit(1)
}

const policy = policyMatch[1]
const directives = policy
  .split(";")
  .map((directive) => directive.trim())
  .filter(Boolean)
const hasBlobWorkerSource = directives.some((directive) =>
  directive.startsWith("worker-src ") && directive.split(/\s+/).includes("blob:")
)

if (hasBlobWorkerSource) {
  console.log("Client CSP already allows blob workers.")
  process.exit(0)
}

const patchedDirectives = directives.filter((directive) => !directive.startsWith("worker-src "))
patchedDirectives.push(workerDirective)

const patchedPolicy = `${patchedDirectives.join("; ")};`
const patchedContent = content.replace(policyMatch[0], `Content-Security-Policy "${patchedPolicy}"`)

writeFileSync(caddyfilePath, patchedContent)
console.log(`Patched client CSP worker-src in ${caddyfilePath}`)
