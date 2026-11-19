export const SAVED_STARTER_RULE = `rule powershell_process_launch {
  meta:
    author = "RuleLab"
    description = "Detects PowerShell process launches."
    severity = "Medium"

  events:
    $e.metadata.event_type = "PROCESS_LAUNCH"
    $e.metadata.product_name = "Windows"
    $e.principal.process.command_line = /powershell/ nocase
    $host = $e.principal.hostname

  match:
    $host over 5m

  condition:
    $e
}`
