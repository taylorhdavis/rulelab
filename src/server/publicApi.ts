import express from "express"
import { randomUUID } from "node:crypto"
import { isIP } from "node:net"
import type { MiddlewareConfigFn } from "wasp/server"

import { formatYaralRule } from "../domain/yaral/formatter"
import {
  compileYaralFile,
  getYaralBlockingDiagnostics,
  resolveYaralDiagnosticProfile,
  type YaralDiagnostic,
  type YaralEvaluationDataTable,
  type YaralEvaluationOptions,
} from "../domain/yaral/compiler"
import {
  compareExpectedResult,
  parseFixtureExpectedResults,
} from "../domain/yaral/testing/expected-results"
import {
  type RuleTestRunResult,
} from "../domain/yaral/testing/run-rule-test"
import {
  validateJsonValueSafety,
  validateUdmEvents,
} from "../domain/yaral/testing/input-validation"
import {
  getYaralRuleTestLimitViolation,
  YARAL_TEST_LIMITS,
} from "../domain/yaral/testing/limits"
import {
  RULE_LIBRARY_LIMITS,
  normalizeDataTable,
  normalizeSavedRule,
} from "./ruleLibraryValidation"
import {
  requireCanCreateLibraryResource,
  requireFixtureEventLimit,
} from "./workspaceLimits"
import {
  PublicApiError,
  authenticateApiKey,
  requireApiRateLimit,
  type ApiKeyPrincipal,
  type ApiKeyScope,
} from "./apiKeys"
import { RATE_LIMITS, requireRateLimit } from "./rateLimit"
import {
  PublicApiLocalTestTimeoutError,
  runPublicApiLocalTest,
} from "./publicApiLocalTest"

type ApiContext = {
  entities: {
    ApiKey: any
    ApiRateLimit: any
    AppSetting: any
    SavedRule?: any
    User: any
  }
}

type ApiResponse = express.Response
type ApiRequest = express.Request

const MAX_SOURCE_LENGTH = YARAL_TEST_LIMITS.ruleSourceMaxLength
const MAX_TEST_EVENTS = YARAL_TEST_LIMITS.testMaxEvents
const MAX_INLINE_DATA_TABLE_ROWS = YARAL_TEST_LIMITS.inlineDataTableMaxRows
const MAX_LOCAL_TEST_DURATION_MS = YARAL_TEST_LIMITS.localTestMaxDurationMs
const MAX_CONCURRENT_LOCAL_TESTS = getPositiveIntegerEnv("PUBLIC_API_MAX_CONCURRENT_LOCAL_TESTS", 2)
const PUBLIC_ERROR_MESSAGE = "Internal server error."
const MAX_ROUTE_ID_LENGTH = 128
const ROUTE_ID_PATTERN = /^[A-Za-z0-9._-]+$/
let activeLocalTests = 0

export const publicApiMiddleware: MiddlewareConfigFn = (middlewareConfig) => {
  middlewareConfig.delete("express.json")
  middlewareConfig.set("express.json", express.json({ limit: "1mb", type: "application/json" }))
  middlewareConfig.set("publicApi.parseError", publicApiParseErrorMiddleware as unknown as express.RequestHandler)
  return middlewareConfig
}

export const publicApiParseErrorMiddleware: express.ErrorRequestHandler = (error, req, res, next) => {
  if (!isBodyParserError(error)) {
    return next(error)
  }
  const requestId = getRequestId(req)
  const statusCode = error.type === "entity.too.large" ? 413 : 400
  const response = res.status(statusCode)
  setPublicApiSecurityHeaders(response)
  return response.json({
    ok: false,
    error: {
      code: statusCode === 413 ? "payload_too_large" : "invalid_request",
      message: statusCode === 413 ? "Payload too large." : "Invalid request.",
      requestId,
    },
  })
}

export async function compileYaralApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "compile",
    scope: "yaral:compile",
  }, async ({ body }) => {
    const source = normalizeSource(body)
    const profile = resolveYaralDiagnosticProfile("editor-default")
    const compiled = compileYaralFile(source, profile.compile)
    return {
      data: {
        diagnostics: compiled.diagnostics.map(serializeDiagnostic),
        parserMode: "rule",
        rules: compiled.rules.map((rule) => ({
          diagnostics: rule.diagnostics.map(serializeDiagnostic),
          summary: rule.summary,
          symbols: rule.symbols,
        })),
      },
      meta: { diagnosticProfile: profile.name },
    }
  })
}

export async function validateYaralApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "compile",
    scope: "yaral:compile",
  }, async ({ body }) => {
    const source = normalizeSource(body)
    const profile = resolveYaralDiagnosticProfile("api-strict")
    const compiled = compileYaralFile(source, profile.compile)
    const blockingDiagnostics = getYaralBlockingDiagnostics(compiled.diagnostics, profile.blocking)
    return {
      data: {
        diagnostics: compiled.diagnostics.map(serializeDiagnostic),
        isValid: blockingDiagnostics.length === 0,
        profile: profile.name,
      },
      meta: {
        blockingDiagnosticCount: blockingDiagnostics.length,
      },
    }
  })
}

export async function formatYaralApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "compile",
    scope: "yaral:compile",
  }, async ({ body }) => {
    const source = normalizeSource(body)
    const profile = resolveYaralDiagnosticProfile("api-strict")
    const compiled = compileYaralFile(source, profile.compile)
    const blockingDiagnostics = getYaralBlockingDiagnostics(compiled.diagnostics, profile.blocking)
    if (blockingDiagnostics.length > 0) {
      throw new PublicApiError(422, "validation_failed", "Validation failed.")
    }
    return {
      data: {
        diagnostics: compiled.diagnostics.map(serializeDiagnostic),
        source: formatYaralRule(source),
      },
    }
  })
}

export async function testYaralApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "test",
    scope: "yaral:test",
  }, async ({ body, principal }) => {
    const source = normalizeSource(body)
    const events = normalizeEvents(body?.events)
    const dataTables = normalizeDataTables(body?.dataTables)
    const evaluationOptions = normalizeEvaluationOptions(body?.evaluationOptions)
    requireNoPublicLimitViolation(getYaralRuleTestLimitViolation({
      dataTables,
      events,
      ruleText: source,
    }))
    await requireFixtureEventLimit({
      createError: createPublicQuotaError,
      eventCount: events.length,
    })
    const runMode = normalizeRunMode(body?.runMode)
    let result: RuleTestRunResult
    try {
      result = await runWithLocalTestSlot(() =>
        runPublicApiLocalTest({
          dataTables,
          events,
          evaluationOptions,
          ruleText: source,
          runMode,
          targetRuleName: typeof body?.targetRuleName === "string" ? body.targetRuleName : null,
        }, { timeoutMs: MAX_LOCAL_TEST_DURATION_MS })
      )
    } catch (error) {
      if (error instanceof PublicApiLocalTestTimeoutError) {
        throw new PublicApiError(503, "temporarily_unavailable", "Service unavailable.")
      }
      throw error
    }
    const expectedResults = parseFixtureExpectedResults(body?.expectedResults)
    const expected = expectedResults
      ? Object.fromEntries(
          result.rules.map((rule) => [
            rule.ruleName,
            expectedResults.rules[rule.ruleName]
              ? compareExpectedResult(rule.result, expectedResults.rules[rule.ruleName])
              : null,
          ])
        )
      : null
    return {
      data: {
        expected,
        result: serializeRuleTestRunResult(result),
      },
      meta: {
        evaluator: "rulelab-local",
        officialRuntime: false,
      },
      warnings: [
        {
          code: "local_evaluator",
          message: "RuleLab local evaluator output is an authoring aid and may not match Google SecOps exactly.",
        },
      ],
    }
  })
}

async function runWithLocalTestSlot<T>(callback: () => Promise<T>) {
  if (activeLocalTests >= MAX_CONCURRENT_LOCAL_TESTS) {
    throw new PublicApiError(503, "temporarily_unavailable", "Service unavailable.")
  }
  activeLocalTests += 1
  try {
    return await callback()
  } finally {
    activeLocalTests -= 1
  }
}

function getPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export async function listRulesApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "rules",
    scope: "rules:read",
  }, async ({ principal }) => {
    const SavedRule = requireSavedRuleEntity(context)
    const rules = await SavedRule.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      where: { ownerId: principal.user.id },
    })
    return {
      data: { rules: rules.map(serializeSavedRule) },
    }
  })
}

export async function createRuleApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "rules",
    scope: "rules:write",
  }, async ({ body, principal }) => {
    const SavedRule = requireSavedRuleEntity(context)
    const input = normalizeSavedRule(body ?? {}, createPublicValidationError)
    const existingRule = await SavedRule.findFirst({
      select: { id: true },
      where: { name: input.name, ownerId: principal.user.id },
    })
    if (existingRule) {
      throw new PublicApiError(409, "validation_failed", "Validation failed.")
    }
    await requireCanCreateLibraryResource({
      context,
      createError: createPublicQuotaError,
      ownerId: principal.user.id,
      resource: "rule",
    })
    const rule = await SavedRule.create({
      data: { ...input, ownerId: principal.user.id },
    })
    return {
      data: { rule: serializeSavedRule(rule) },
      statusCode: 201,
    }
  })
}

export async function getRuleApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "rules",
    scope: "rules:read",
  }, async ({ principal }) => {
    const rule = await getOwnedRule(context, principal, getRouteParam(req.params.id))
    return { data: { rule: serializeSavedRule(rule) } }
  })
}

export async function updateRuleApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "rules",
    scope: "rules:write",
  }, async ({ body, principal }) => {
    const SavedRule = requireSavedRuleEntity(context)
    const rule = await getOwnedRule(context, principal, getRouteParam(req.params.id))
    const input = normalizeSavedRule({ ...body, name: body?.name ?? rule.name }, createPublicValidationError)
    const duplicate = await SavedRule.findFirst({
      select: { id: true },
      where: { name: input.name, ownerId: principal.user.id },
    })
    if (duplicate && duplicate.id !== rule.id) {
      throw new PublicApiError(409, "validation_failed", "Validation failed.")
    }
    const updated = await SavedRule.update({
      data: input,
      where: { id: rule.id },
    })
    return { data: { rule: serializeSavedRule(updated) } }
  })
}

export async function deleteRuleApi(req: ApiRequest, res: ApiResponse, context: ApiContext) {
  return handleApiRequest(req, res, context, {
    family: "rules",
    scope: "rules:write",
  }, async ({ principal }) => {
    const SavedRule = requireSavedRuleEntity(context)
    const rule = await getOwnedRule(context, principal, getRouteParam(req.params.id))
    await SavedRule.delete({ where: { id: rule.id } })
    return { data: { deleted: true } }
  })
}

async function handleApiRequest(
  req: ApiRequest,
  res: ApiResponse,
  context: ApiContext,
  options: {
    family: "compile" | "rules" | "test"
    scope: ApiKeyScope
  },
  handler: (input: {
    body: any
    principal: ApiKeyPrincipal
    requestId: string
  }) => Promise<{
    data?: unknown
    meta?: Record<string, unknown>
    statusCode?: number
    warnings?: unknown[]
  }>
) {
  const requestId = getRequestId(req)
  const startedAt = Date.now()
  let principal: ApiKeyPrincipal | null = null
  try {
    if (requiresJsonBody(req) && !isJsonRequest(req)) {
      throw new PublicApiError(415, "invalid_request", "Invalid request.")
    }
    const ipAddress = getIpAddress(req)
    await requirePublicApiAuthRateLimit(context, ipAddress)
    principal = await authenticateApiKey(
      context,
      req.headers.authorization,
      options.scope,
      ipAddress
    )
    await requireApiRateLimit({ context, family: options.family, ipAddress, principal })
    const result = await handler({ body: req.body, principal, requestId })
    logPublicApiRequest({
      body: req.body,
      durationMs: Date.now() - startedAt,
      family: options.family,
      principal,
      requestId,
      route: req.path ?? req.originalUrl ?? req.url ?? "unknown",
      statusCode: result.statusCode ?? 200,
    })
    const response = res.status(result.statusCode ?? 200)
    setPublicApiSecurityHeaders(response)
    return response.json({
      ok: true,
      data: result.data ?? {},
      meta: {
        requestId,
        ...(result.meta ?? {}),
      },
      ...(result.warnings ? { warnings: result.warnings } : {}),
    })
  } catch (error) {
    logPublicApiRequest({
      body: req.body,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof PublicApiError ? error.code : "internal_error",
      family: options.family,
      principal,
      requestId,
      route: req.path ?? req.originalUrl ?? req.url ?? "unknown",
      statusCode: error instanceof PublicApiError ? error.statusCode : 500,
    })
    return sendApiError(res, error, requestId)
  }
}

type PublicApiLogInput = {
  body: unknown
  durationMs: number
  errorCode?: string
  family: "compile" | "rules" | "test"
  principal: ApiKeyPrincipal | null
  requestId: string
  route: string
  statusCode: number
}

function logPublicApiRequest(input: PublicApiLogInput) {
  console.info("Public API request", buildPublicApiLogEntry(input))
}

export function buildPublicApiLogEntry(input: PublicApiLogInput) {
  return {
    durationMs: input.durationMs,
    errorCode: input.errorCode ?? null,
    family: input.family,
    keyPrefix: input.principal?.apiKey.prefix ?? null,
    ownerId: input.principal?.user.id ?? null,
    payload: getPayloadMetrics(input.body),
    requestId: input.requestId,
    route: input.route,
    statusCode: input.statusCode,
  }
}

function sendApiError(res: ApiResponse, error: unknown, requestId: string) {
  setPublicApiSecurityHeaders(res)
  if (error instanceof PublicApiError) {
    if (error.retryAfterSeconds) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds))
    }
    return res.status(error.statusCode).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    })
  }
  console.error("Public API request failed", { error, requestId })
  return res.status(500).json({
    ok: false,
    error: {
      code: "internal_error",
      message: PUBLIC_ERROR_MESSAGE,
      requestId,
    },
  })
}

async function requirePublicApiAuthRateLimit(context: ApiContext, ipAddress: string | null) {
  await requireRateLimit({
    bucket: "public-api-auth",
    context,
    createError: (statusCode, message) =>
      new PublicApiError(statusCode, "rate_limited", message, 60),
    key: ipAddress ?? "unknown",
    ...RATE_LIMITS.publicApiAuth,
  })
}

function normalizeSource(body: any) {
  if (!body || typeof body.source !== "string") {
    throw new PublicApiError(400, "invalid_request", "Invalid request.")
  }
  const source = body.source.trim()
  if (!source) {
    throw new PublicApiError(400, "invalid_request", "Invalid request.")
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new PublicApiError(413, "payload_too_large", "Payload too large.")
  }
  return source
}

function normalizeEvents(value: unknown) {
  if (!Array.isArray(value)) {
    throw new PublicApiError(400, "invalid_request", "Invalid request.")
  }
  const safetyError = validateJsonValueSafety(value, "test events")
  if (safetyError) {
    throw new PublicApiError(400, "invalid_request", "Invalid request.")
  }
  const validationError = validateUdmEvents(value)
  if (validationError) {
    throw new PublicApiError(422, "validation_failed", "Validation failed.")
  }
  return value as Record<string, unknown>[]
}

function normalizeDataTables(value: unknown): YaralEvaluationDataTable[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new PublicApiError(400, "invalid_request", "Invalid request.")
  }
  return value.map((table) => {
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      throw new PublicApiError(400, "invalid_request", "Invalid request.")
    }
    const record = table as Record<string, unknown>
    if (typeof record.name !== "string" || !Array.isArray(record.rows)) {
      throw new PublicApiError(400, "invalid_request", "Invalid request.")
    }
    if (record.rows.length > MAX_INLINE_DATA_TABLE_ROWS) {
      throw new PublicApiError(413, "payload_too_large", "Payload too large.")
    }
    const safetyError = validateJsonValueSafety(record.rows, "data table rows")
    if (safetyError) {
      throw new PublicApiError(400, "invalid_request", "Invalid request.")
    }
    const normalized = normalizeDataTable(
      { name: record.name, rows: record.rows },
      createPublicValidationError
    )
    return {
      name: normalized.name,
      rows: normalized.rows,
    }
  })
}

function requireNoPublicLimitViolation(violation: ReturnType<typeof getYaralRuleTestLimitViolation>) {
  if (!violation) {
    return
  }
  throw new PublicApiError(
    violation.code === "source" ? 400 : 413,
    violation.code === "source" ? "invalid_request" : "payload_too_large",
    violation.code === "source" ? "Invalid request." : "Payload too large."
  )
}

function normalizeRunMode(value: unknown): "all" | "first" | "target" {
  if (value === undefined || value === null || value === "first") {
    return "first"
  }
  if (value === "all" || value === "target") {
    return value
  }
  throw new PublicApiError(400, "invalid_request", "Invalid request.")
}

function normalizeEvaluationOptions(value: unknown): Pick<YaralEvaluationOptions, "evaluationRange" | "matchKeyUniverse"> {
  if (value === undefined || value === null) {
    return {}
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicApiError(400, "invalid_request", "Invalid request.")
  }
  const result: Pick<YaralEvaluationOptions, "evaluationRange" | "matchKeyUniverse"> = {}
  const range = (value as Record<string, unknown>).evaluationRange
  if (range !== undefined && range !== null) {
    if (!range || typeof range !== "object" || Array.isArray(range)) {
      throw new PublicApiError(400, "invalid_request", "Invalid request.")
    }
    const { end, start } = range as Record<string, unknown>
    if (!isEvaluationRangeBoundary(start) || !isEvaluationRangeBoundary(end)) {
      throw new PublicApiError(400, "invalid_request", "Invalid request.")
    }
    result.evaluationRange = {
      end,
      start,
    }
  }
  const matchKeyUniverse = (value as Record<string, unknown>).matchKeyUniverse
  if (matchKeyUniverse !== undefined && matchKeyUniverse !== null) {
    if (!matchKeyUniverse || typeof matchKeyUniverse !== "object" || Array.isArray(matchKeyUniverse)) {
      throw new PublicApiError(400, "invalid_request", "Invalid request.")
    }
    result.matchKeyUniverse = Object.fromEntries(
      Object.entries(matchKeyUniverse as Record<string, unknown>).map(([key, values]) => {
        const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
        const validValues =
          Array.isArray(values) && values.every((item) => isMatchKeyUniverseValue(item))
        if (!validKey || !validValues) {
          throw new PublicApiError(400, "invalid_request", "Invalid request.")
        }
        return [key, values]
      })
    )
  }
  return result
}

function isEvaluationRangeBoundary(value: unknown): value is number | string {
  if (typeof value === "number") {
    return Number.isFinite(value)
  }
  return typeof value === "string" && value.trim().length > 0
}

function isMatchKeyUniverseValue(value: unknown): value is boolean | number | string | null {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
}

function createPublicValidationError(statusCode: number) {
  return new PublicApiError(
    statusCode >= 500 ? 500 : statusCode,
    statusCode === 413 ? "payload_too_large" : "validation_failed",
    statusCode === 413 ? "Payload too large." : "Validation failed."
  )
}

function createPublicQuotaError(statusCode: number) {
  return new PublicApiError(
    statusCode,
    statusCode === 402 ? "quota_exceeded" : "validation_failed",
    statusCode === 402 ? "Quota exceeded." : "Validation failed."
  )
}

async function getOwnedRule(
  context: ApiContext,
  principal: ApiKeyPrincipal,
  id: string | undefined
) {
  if (!isValidRouteId(id)) {
    throw new PublicApiError(404, "not_found", "Not found.")
  }
  const SavedRule = requireSavedRuleEntity(context)
  const rule = await SavedRule.findFirst({
    where: { id, ownerId: principal.user.id },
  })
  if (!rule) {
    throw new PublicApiError(404, "not_found", "Not found.")
  }
  return rule
}

function requireSavedRuleEntity(context: ApiContext) {
  if (!context.entities.SavedRule) {
    throw new PublicApiError(500, "internal_error", PUBLIC_ERROR_MESSAGE)
  }
  return context.entities.SavedRule
}

function serializeSavedRule(rule: any) {
  return {
    createdAt: rule.createdAt,
    description: rule.description,
    folder: rule.folder ?? null,
    id: rule.id,
    name: rule.name,
    source: rule.source,
    tags: rule.tags ?? [],
    updatedAt: rule.updatedAt,
  }
}

function serializeDiagnostic(diagnostic: YaralDiagnostic) {
  return {
    code: diagnostic.code ?? getFallbackDiagnosticCode(diagnostic),
    column: diagnostic.column,
    line: diagnostic.line,
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source ?? "validation",
  }
}

function serializeRuleTestRunResult(result: RuleTestRunResult) {
  return {
    diagnostics: result.diagnostics.map(serializeDiagnostic),
    rules: result.rules.map((rule) => ({
      diagnostics: rule.diagnostics.map(serializeDiagnostic),
      result: {
        ...rule.result,
        diagnostics: rule.result.diagnostics.map(serializeDiagnostic),
      },
      ruleName: rule.ruleName,
    })),
  }
}

function getFallbackDiagnosticCode(diagnostic: YaralDiagnostic) {
  return diagnostic.severity === "warning"
    ? "yaral.warning"
    : "yaral.error"
}

function getPayloadMetrics(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      dataTableCount: 0,
      dataTableRowCount: 0,
      eventCount: 0,
      sourceLength: 0,
    }
  }
  const record = body as Record<string, unknown>
  return {
    dataTableCount: Array.isArray(record.dataTables) ? record.dataTables.length : 0,
    dataTableRowCount: countInlineDataTableRows(record.dataTables),
    eventCount: Array.isArray(record.events) ? record.events.length : 0,
    sourceLength: typeof record.source === "string" ? record.source.length : 0,
  }
}

function countInlineDataTableRows(value: unknown) {
  if (!Array.isArray(value)) {
    return 0
  }
  return value.reduce((count, table) => {
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      return count
    }
    const rows = (table as Record<string, unknown>).rows
    return count + (Array.isArray(rows) ? rows.length : 0)
  }, 0)
}

function getRequestId(req: ApiRequest) {
  const existing = req.headers["x-request-id"]
  const requestId = Array.isArray(existing) ? existing[0] : existing
  return typeof requestId === "string" && requestId.trim()
    ? requestId.trim().slice(0, 80)
    : randomUUID()
}

function getRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isValidRouteId(value: string | undefined) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ROUTE_ID_LENGTH &&
    ROUTE_ID_PATTERN.test(value)
  )
}

function setPublicApiSecurityHeaders(res: ApiResponse) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
}


function getIpAddress(req: ApiRequest) {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const forwardedFor = req.headers["x-forwarded-for"]
    const firstForwardedHeader = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor
    if (typeof firstForwardedHeader === "string" && firstForwardedHeader.trim()) {
      const forwardedIp = firstForwardedHeader
        .split(",")
        .map((value) => value.trim())
        .find((value) => value.length > 0)
      if (forwardedIp && isIP(forwardedIp)) {
        return forwardedIp
      }
    }
  }
  return req.ip || null
}

function requiresJsonBody(req: ApiRequest) {
  return ["PATCH", "POST", "PUT"].includes(req.method.toUpperCase())
}

function isJsonRequest(req: ApiRequest) {
  return req.is("application/json") === "application/json"
}

function isBodyParserError(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (
      (error as { type?: unknown }).type === "entity.parse.failed" ||
      (error as { type?: unknown }).type === "entity.too.large"
    )
}
