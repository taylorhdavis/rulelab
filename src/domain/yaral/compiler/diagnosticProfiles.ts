import type { YaralCompileOptions } from "./types"
import type { YaralDiagnosticProfileOptions } from "./diagnostics"

export type YaralNamedDiagnosticProfile =
  | "api-strict"
  | "editor-default"
  | "strict-save"

export type YaralResolvedDiagnosticProfile = {
  blocking: YaralDiagnosticProfileOptions
  compile: YaralCompileOptions
  name: YaralNamedDiagnosticProfile
}

export function resolveYaralDiagnosticProfile(
  name: YaralNamedDiagnosticProfile
): YaralResolvedDiagnosticProfile {
  switch (name) {
    case "api-strict":
    case "strict-save":
      return {
        blocking: { diagnosticProfile: "strict" },
        compile: {},
        name,
      }
    case "editor-default":
      return {
        blocking: { diagnosticProfile: "editor" },
        compile: {},
        name,
      }
  }
}
