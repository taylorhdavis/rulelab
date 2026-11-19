export const WORKSPACE_LIMITS = {
  rules: 1_000,
  fixtures: 500,
  dataTables: 100,
  fixtureEventsPerSet: 1_000,
} as const

export function formatLimit(value: number) {
  return value.toLocaleString("en-US")
}
