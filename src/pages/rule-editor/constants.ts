export { SAVED_STARTER_RULE } from "../../domain/yaral/starter-rule"

export const DEFAULT_RULE_NAME_PREFIX = "user_login"

export function createDefaultRuleName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${DEFAULT_RULE_NAME_PREFIX}_${timestamp}_${suffix}`
}

export function createDefaultRule(ruleName = createDefaultRuleName()) {
  return `rule ${ruleName} {
  meta:
    author = "RuleLab"
    description = "Detects successful user login events."
    severity = "Low"

  events:
    $e.metadata.event_type = "USER_LOGIN"
    $e.principal.user.userid = /.+/

  condition:
    $e
}`
}

export const DEFAULT_RULE = createDefaultRule(`${DEFAULT_RULE_NAME_PREFIX}_example`)

export const LEGACY_DEFAULT_RULES = [
  `rule SingleEventRule {
meta:
  author = "noone@altostrat.com"

events:
  $e.metadata.event_type = "USER_LOGIN"

condition:
  $e
}`,
  `rule suspicious_powershell_activity {

  meta:
    author = "admin"
    severity = "medium"
    description = "Detects suspicious PowerShell execution patterns."

  events:
    $e.metadata.product_name = "Windows"
    $e.metadata.event_type = "PROCESS_LAUNCH"
    $e.principal.process.command_line = /powershell/ nocase
    $host = $e.principal.hostname

  match:
    $host over 5m

  condition:
    $e
}`,
] as const

export const FONT_SIZE_MIN = 9
export const FONT_SIZE_MAX = 24

export const OUTPUT_PANEL_DEFAULT_HEIGHT = 300
export const OUTPUT_PANEL_MAX_HEIGHT = 640
export const OUTPUT_PANEL_MIN_HEIGHT = 210

export const INSPECTOR_DEFAULT_WIDTH = 480
export const INSPECTOR_COLLAPSED_WIDTH = 40
export const INSPECTOR_MAX_WIDTH = 480
export const INSPECTOR_MIN_WIDTH = 260

export const VALIDATION_LINES = [
  { ok: true, text: "Parsed rule block" },
  { ok: true, text: "Meta fields found" },
  { ok: true, text: "Event filters validated" },
  { ok: true, text: "Match window is valid" },
  { ok: true, text: "Condition resolves to boolean" },
  { ok: true, text: "No unreferenced variables" },
  { ok: true, text: "Compilation successful" },
] as const
