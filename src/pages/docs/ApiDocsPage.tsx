import { Link } from "react-router"

import { Badge } from "../../components/ui/badge"
import { CodeBlock } from "../../components/ui/code-block"
import { TextLink } from "../../components/ui/text-link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table"

type ApiMethod = "GET" | "POST" | "PUT" | "DELETE"

type ApiEndpoint = {
  auth: string
  description: string
  method: ApiMethod
  path: string
  requestBody?: string
  responses: string
}

const apiEndpoints: ApiEndpoint[] = [
  {
    auth: "yaral:compile",
    description: "Compile YARA-L with diagnostics and rule metadata.",
    method: "POST",
    path: "\/api/v1/yaral/compile",
    requestBody: "source: string (required)",
    responses: "200, 400, 401, 403, 413, 415, 429, 500",
  },
  {
    auth: "yaral:compile",
    description: "Validate YARA-L syntax with strict blocking profile.",
    method: "POST",
    path: "\/api/v1/yaral/validate",
    requestBody: "source: string (required)",
    responses: "200, 400, 401, 403, 415, 429, 500",
  },
  {
    auth: "yaral:compile",
    description: "Format YARA-L source into canonical style.",
    method: "POST",
    path: "\/api/v1/yaral/format",
    requestBody: "source: string (required)",
    responses: "200, 400, 401, 403, 415, 422, 429, 500",
  },
  {
    auth: "yaral:test",
    description: "Run local evaluator against inline test events.",
    method: "POST",
    path: "\/api/v1/yaral/test",
    requestBody: "source, events (+ optional expectedResults, dataTables, evaluationOptions.evaluationRange, evaluationOptions.matchKeyUniverse, runMode, targetRuleName)",
    responses: "200, 400, 401, 403, 413, 415, 422, 429, 503, 500",
  },
  {
    auth: "rules:read",
    description: "List caller-owned saved rules.",
    method: "GET",
    path: "\/api/v1/rules",
    responses: "200, 401, 403, 429, 500",
  },
  {
    auth: "rules:write",
    description: "Create a caller-owned saved rule.",
    method: "POST",
    path: "\/api/v1/rules",
    requestBody: "name, source, description?, folder?, tags?",
    responses: "201, 400, 401, 403, 409, 413, 429, 500",
  },
  {
    auth: "rules:read",
    description: "Fetch one caller-owned rule by id.",
    method: "GET",
    path: "\/api/v1/rules/{id}",
    requestBody: "id path parameter",
    responses: "200, 401, 403, 404, 429, 500",
  },
  {
    auth: "rules:write",
    description: "Replace one caller-owned rule.",
    method: "PUT",
    path: "\/api/v1/rules/{id}",
    requestBody: "name?, source?, description?, folder?, tags?",
    responses: "200, 400, 401, 403, 409, 422, 429, 500",
  },
  {
    auth: "rules:write",
    description: "Delete one caller-owned rule.",
    method: "DELETE",
    path: "\/api/v1/rules/{id}",
    requestBody: "id path parameter",
    responses: "200, 401, 403, 404, 429, 500",
  },
]

const authHeaders = [
  {
    name: "Authorization",
    required: "Required",
    value: "Bearer <api_key>",
  },
  {
    name: "Content-Type",
    required: "Required",
    value: "application/json",
  },
]

const errorResponses = [
  {
    code: "unauthorized",
    message: "Missing/invalid/expired key.",
    status: "401",
  },
  {
    code: "forbidden",
    message: "API access disabled or missing scope.",
    status: "403",
  },
  {
    code: "not_found",
    message: "Requested resource does not exist.",
    status: "404",
  },
  {
    code: "invalid_request",
    message: "JSON/body format or required fields are invalid.",
    status: "400",
  },
  {
    code: "validation_failed",
    message: "YARA-L rule or payload validation failed.",
    status: "409 or 422",
  },
  {
    code: "payload_too_large",
    message: "Request payload exceeded allowed size limits.",
    status: "413",
  },
  {
    code: "rate_limited",
    message: "Rate or abuse limits reached.",
    status: "429",
  },
  {
    code: "temporarily_unavailable",
    message: "Service unavailable (for example local evaluation timeout).",
    status: "503",
  },
]

const rateLimits = [
  { family: "yaral (compile/validate/format)", perMinute: "300", perDay: "20,000" },
  { family: "yaral test", perMinute: "60", perDay: "2,000" },
  { family: "rules API", perMinute: "120", perDay: "5,000" },
]

const requestExample = `POST /api/v1/yaral/validate
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "source": "rule api_example {\n  events:\n    $e.metadata.event_type = \"USER_LOGIN\"\n  condition:\n    $e\n}",
  "events": [
    {
      "metadata": {
        "event_type": "USER_LOGIN"
      }
    }
  ]
}`

const responseExample = `{
  "ok": true,
  "data": {
    "diagnostics": [],
    "isValid": true,
    "profile": "strict"
  },
  "meta": {
    "requestId": "f3de9a00-..."
  }
}`

const errorExample = `{
  "ok": false,
  "error": {
    "code": "validation_failed",
    "message": "Validation failed.",
    "requestId": "f3de9a00-..."
  },
  "meta": {
    "requestId": "f3de9a00-..."
  }
}`

export function ApiDocsPage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">RuleLab API</p>
          <h1 className="text-3xl font-semibold tracking-tight">API reference</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            v1 APIs under <code>/api/v1</code> for YARA-L validation, compilation, local testing, and saved-rule
            management. API keys are available to all accounts when the instance administrator enables API access.
          </p>
        </header>

        <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h2 className="text-lg font-medium">Availability</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Enable API access in instance settings and configure an API-key hashing secret before creating keys. Authentication, scopes, and request limits apply to every account.
          </p>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="text-lg font-medium">Reference links</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              OpenAPI 3.0 specification:
              <TextLink className="ml-1" href="/api-docs/openapi.json">
                /api-docs/openapi.json
              </TextLink>
            </li>
            <li>
              Request examples:
              <TextLink className="ml-1" href="/api-docs/examples.json">
                /api-docs/examples.json
              </TextLink>
            </li>
            <li>
              API key management:
              <TextLink asChild className="ml-1"><Link to="/profile/api">Profile → API</Link></TextLink>
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Base URL</h2>
          <p className="text-sm text-muted-foreground">
            Your configured API server origin + <code>/api/v1</code> (locally, <code>http://localhost:3001/api/v1</code>)
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Security model</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>All API requests require <code>Authorization: Bearer &lt;api_key&gt;</code> and <code>Content-Type: application/json</code>.</li>
            <li>API keys are returned only once, at creation time.</li>
            <li>Access is controlled per endpoint by scope (for example <code>yaral:compile</code>, <code>rules:write</code>).</li>
            <li>Invalid/missing/revoked keys return <code>401</code>; scope mismatch returns <code>403</code>.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Authentication</h2>
          <div className="rounded-lg border p-1 text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Header</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Required</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authHeaders.map((header) => (
                  <TableRow key={header.name}>
                    <TableCell className="font-medium">{header.name}</TableCell>
                    <TableCell>
                      <code className="break-all text-xs">{header.value}</code>
                    </TableCell>
                    <TableCell>{header.required}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Endpoint contract</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Auth scope</TableHead>
                  <TableHead>Request body</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Responses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiEndpoints.map((endpoint) => (
                  <TableRow key={`${endpoint.path}-${endpoint.method}`}>
                    <TableCell>
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                        {endpoint.method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <code>{endpoint.path}</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <code>{endpoint.auth}</code>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{endpoint.requestBody ?? "No body"}</TableCell>
                    <TableCell className="text-muted-foreground">{endpoint.description}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{endpoint.responses}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Error model</h2>
          <p className="text-sm text-muted-foreground">
            All responses use a stable envelope with <code>ok</code> plus either <code>data/meta</code> or <code>error</code>.
          </p>
          <CodeBlock><code>{errorExample}</code></CodeBlock>
          <div className="rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Meaning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errorResponses.map((error) => (
                  <TableRow key={error.code}>
                    <TableCell>{error.status}</TableCell>
                    <TableCell>
                      <code>{error.code}</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{error.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Rate limits</h2>
          <p className="text-sm text-muted-foreground">
            Rate limits apply per API key, owner, IP hash, and globally. 429 responses include <code>Retry-After</code> and include error code
            <code>rate_limited</code>.
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Family</TableHead>
                  <TableHead>Per minute</TableHead>
                  <TableHead>Per day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rateLimits.map((item) => (
                  <TableRow key={item.family}>
                    <TableCell className="text-muted-foreground">{item.family}</TableCell>
                    <TableCell>{item.perMinute}</TableCell>
                    <TableCell>{item.perDay}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Data limits</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Maximum source length: 250,000 characters.</li>
            <li>Maximum events in local-test payload: 1,000.</li>
            <li>Maximum inline data-table rows: 2,000.</li>
            <li>Requests are JSON-parsed with <code>1mb</code> body limit.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Examples</h2>
          <p className="text-sm text-muted-foreground">Request</p>
          <CodeBlock><code>{requestExample}</code></CodeBlock>
          <p className="text-sm text-muted-foreground">Response</p>
          <CodeBlock><code>{responseExample}</code></CodeBlock>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Runtime note</h2>
          <p className="text-sm text-muted-foreground">
            Local test responses include <code>meta.evaluator = "rulelab-local"</code> and <code>meta.officialRuntime = false</code>.
            They are authoring aids and may not match Google SecOps runtime exactly.
          </p>
        </section>
      </section>
    </main>
  )
}
