import { formatLimit, WORKSPACE_LIMITS } from "../domain/workspace"

export type WorkspaceLimitErrorFactory = (statusCode: number, message: string) => Error

export type LibraryLimitResource = "dataTable" | "fixture" | "fixtureEvents" | "rule"

type LibraryLimitCheck = {
  currentCount?: number
  requestedAmount?: number
  resource: LibraryLimitResource
}

const RESOURCE_LABELS: Record<LibraryLimitResource, string> = {
  dataTable: "data tables",
  fixture: "test cases",
  fixtureEvents: "events per test case",
  rule: "saved rules",
}

export function getLibraryLimitViolation({
  currentCount = 0,
  requestedAmount = 1,
  resource,
}: LibraryLimitCheck) {
  const limit = getResourceLimit(resource)
  const isOverLimit =
    resource === "fixtureEvents"
      ? requestedAmount > limit
      : currentCount >= limit

  if (!isOverLimit) {
    return null
  }

  return `Workspace limit reached: ${formatLimit(limit)} ${RESOURCE_LABELS[resource]}.`
}

export async function requireCanCreateLibraryResource({
  context,
  createError,
  ownerId,
  requestedAmount,
  resource,
}: {
  context: any
  createError: WorkspaceLimitErrorFactory
  ownerId: string
  requestedAmount?: number
  resource: Exclude<LibraryLimitResource, "fixtureEvents">
}) {
  const currentCount = await countResource(context, ownerId, resource)
  const violation = getLibraryLimitViolation({
    currentCount,
    requestedAmount,
    resource,
  })
  if (violation) {
    throw createError(409, violation)
  }
}

export async function requireFixtureEventLimit({
  createError,
  eventCount,
}: {
  createError: WorkspaceLimitErrorFactory
  eventCount: number
}) {
  const violation = getLibraryLimitViolation({
    requestedAmount: eventCount,
    resource: "fixtureEvents",
  })
  if (violation) {
    throw createError(409, violation)
  }
}

async function countResource(
  context: any,
  ownerId: string,
  resource: Exclude<LibraryLimitResource, "fixtureEvents">
) {
  if (resource === "rule") {
    return context.entities.SavedRule.count({ where: { ownerId } })
  }
  if (resource === "fixture") {
    return context.entities.UdmEventSet.count({ where: { ownerId } })
  }
  return context.entities.DataTable.count({ where: { ownerId } })
}

function getResourceLimit(resource: LibraryLimitResource) {
  if (resource === "rule") {
    return WORKSPACE_LIMITS.rules
  }
  if (resource === "fixture") {
    return WORKSPACE_LIMITS.fixtures
  }
  if (resource === "dataTable") {
    return WORKSPACE_LIMITS.dataTables
  }
  return WORKSPACE_LIMITS.fixtureEventsPerSet
}
