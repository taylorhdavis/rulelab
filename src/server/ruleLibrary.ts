import { HttpError } from "wasp/server"
import type {
  DeleteDataTable,
  DeleteRule,
  DeleteUdmEventSet,
  GetDataTables,
  GetSavedRules,
  GetUdmEventSets,
  SaveDataTable,
  SaveRule,
  SaveUdmEventSet,
} from "wasp/server/operations"
import {
  normalizeDataTable,
  hasSavedRuleChanged,
  normalizeSavedRule,
  normalizeUdmEventSet,
  requireAuthenticatedUserId,
  requireUnchangedImmutableName,
  requireDeleteId,
} from "./ruleLibraryValidation"
import type {
  DeleteArgs,
  SaveDataTableArgs,
  SaveRuleArgs,
  SaveUdmEventSetArgs,
  RuleVersionArgs,
} from "./ruleLibraryValidation"
import {
  requireCanCreateLibraryResource,
  requireFixtureEventLimit,
} from "./workspaceLimits"
import { requireAppAccess } from "./appSettings"
import { RATE_LIMITS, requireRateLimit } from "./rateLimit"
import {
  shouldSeedStarterLibrary,
  STARTER_LIBRARY_SEEDED_PREFERENCE_KEY,
} from "./starterLibrarySeed"
import { SAVED_STARTER_RULE } from "../domain/yaral/starter-rule"

export type SavedRuleRecord = {
  createdAt: Date
  description: string | null
  folder?: string | null
  id: string
  name: string
  ownerId?: string | null
  source: string
  tags?: string[]
  updatedAt: Date
}

export type SavedRuleVersionRecord = {
  createdAt: Date
  description: string | null
  folder: string | null
  id: string
  name: string
  ownerId?: string | null
  savedRuleId: string
  source: string
  tags: string[]
}

export type UdmEventSetRecord = {
  createdAt: Date
  description: string | null
  events: any
  expectedResults: any | null
  id: string
  name: string
  ownerId?: string | null
  savedRuleId: string | null
  updatedAt: Date
}

export type DataTableRecord = {
  createdAt: Date
  description: string | null
  id: string
  name: string
  ownerId?: string | null
  rows: any
  updatedAt: Date
}

const createHttpError = (statusCode: number, message: string) => new HttpError(statusCode, message)
const DEFAULT_RULE_NAME = "powershell_process_launch"
const DEFAULT_RULE_DESCRIPTION = "Detects PowerShell process launches."
const DEFAULT_TEST_CASE_NAME = "PowerShell process launch"
const DEFAULT_TEST_CASE_DESCRIPTION = "Positive test case for the default PowerShell process launch rule."
const DEFAULT_TEST_CASE_EVENTS = [
  {
    metadata: {
      event_timestamp: { nanos: 0, seconds: 1767258000 },
      event_type: "PROCESS_LAUNCH",
      product_name: "Windows",
    },
    principal: {
      hostname: "WORKSTATION-1",
      process: {
        command_line: "powershell.exe -NoProfile -ExecutionPolicy Bypass",
      },
    },
  },
]

const requireUserId = (context: { user?: { id: string } | null }) =>
  requireAuthenticatedUserId(context, createHttpError)

async function requireLibraryMutationRateLimit(context: unknown, ownerId: string) {
  await requireRateLimit({
    bucket: "library-mutation",
    context,
    createError: createHttpError,
    key: ownerId,
    ownerId,
    ...RATE_LIMITS.libraryMutation,
  })
}

export const getSavedRules: GetSavedRules<void, SavedRuleRecord[]> = async (_args, context) => {
  const ownerId = requireUserId(context)
  await requireAppAccess(context)
  await ensureDefaultRuleAndTestCase(context, ownerId)

  return context.entities.SavedRule.findMany({
    where: { ownerId },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  })
}

export const saveRule: SaveRule<SaveRuleArgs, SavedRuleRecord> = async (args, context) => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  const data = { ...normalizeSavedRule(args, createHttpError), ownerId }
  let existingRule: SavedRuleRecord | null = null
  if (args.id) {
    existingRule = await context.entities.SavedRule.findFirst({
      where: { id: args.id, ownerId },
    })
    if (!existingRule) {
      throw new HttpError(404, "Rule not found.")
    }
  }
  const existingRuleByName = await context.entities.SavedRule.findFirst({
    where: { name: data.name, ownerId },
  })
  if (existingRuleByName && args.id && existingRuleByName.id !== args.id) {
    throw new HttpError(409, `A rule named "${data.name}" already exists.`)
  }

  if (args.id) {
    if (existingRule) {
      if (!hasSavedRuleChanged(existingRule, data)) {
        return existingRule
      }
      await createSavedRuleVersion(context, existingRule)
    }
    return context.entities.SavedRule.update({ data, where: { id: args.id } })
  }

  if (existingRuleByName) {
    throw new HttpError(409, `A rule named "${data.name}" already exists.`)
  }
  await requireCanCreateLibraryResource({
    context,
    createError: createHttpError,
    ownerId,
    resource: "rule",
  })
  return context.entities.SavedRule.create({ data })
}

export const getSavedRuleVersions = async (
  args: RuleVersionArgs,
  context: any
): Promise<SavedRuleVersionRecord[]> => {
  const ownerId = requireUserId(context)
  await requireAppAccess(context)
  if (!args.ruleId) {
    throw new HttpError(400, "Rule id is required.")
  }
  const rule = await context.entities.SavedRule.findFirst({
    select: { id: true },
    where: { id: args.ruleId, ownerId },
  })
  if (!rule) {
    throw new HttpError(404, "Rule not found.")
  }

  return context.entities.SavedRuleVersion.findMany({
    where: { savedRuleId: args.ruleId, ownerId },
    orderBy: { createdAt: "desc" },
    take: 5,
  })
}

export const restoreSavedRuleVersion = async (
  args: RuleVersionArgs,
  context: any
): Promise<SavedRuleRecord> => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  if (!args.versionId) {
    throw new HttpError(400, "Rule version id is required.")
  }
  const version = await context.entities.SavedRuleVersion.findFirst({
    where: { id: args.versionId, ownerId },
  })
  if (!version) {
    throw new HttpError(404, "Rule version not found.")
  }
  const currentRule = await context.entities.SavedRule.findFirst({
    where: { id: version.savedRuleId, ownerId },
  })
  if (!currentRule) {
    throw new HttpError(404, "Rule not found.")
  }

  await createSavedRuleVersion(context, currentRule)
  return context.entities.SavedRule.update({
    data: {
      description: version.description,
      folder: version.folder,
      name: version.name,
      source: version.source,
      tags: version.tags ?? [],
    },
    where: { id: version.savedRuleId },
  })
}

export const deleteRule: DeleteRule<DeleteArgs, SavedRuleRecord> = async (args, context) => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  requireDeleteId(args, "Rule id is required.", createHttpError)
  const existingRule = await context.entities.SavedRule.findFirst({
    where: { id: args.id, ownerId },
  })
  if (!existingRule) {
    throw new HttpError(404, "Rule not found.")
  }

  return context.entities.SavedRule.delete({
    where: { id: args.id },
  })
}

async function createSavedRuleVersion(context: any, rule: SavedRuleRecord) {
  return context.entities.SavedRuleVersion.create({
    data: {
      description: rule.description,
      folder: rule.folder ?? null,
      name: rule.name,
      ownerId: rule.ownerId ?? null,
      savedRuleId: rule.id,
      source: rule.source,
      tags: rule.tags ?? [],
    },
  })
}

export const getUdmEventSets: GetUdmEventSets<void, UdmEventSetRecord[]> = async (
  _args,
  context
) => {
  const ownerId = requireUserId(context)
  await requireAppAccess(context)
  await ensureDefaultRuleAndTestCase(context, ownerId)

  return context.entities.UdmEventSet.findMany({
    where: { ownerId },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  })
}

async function ensureDefaultRuleAndTestCase(context: any, ownerId: string) {
  const starterPreference = await context.entities.UserPreference.findUnique({
    where: {
      ownerId_key: {
        key: STARTER_LIBRARY_SEEDED_PREFERENCE_KEY,
        ownerId,
      },
    },
  })
  if (!shouldSeedStarterLibrary(starterPreference)) {
    return
  }

  const defaultRule = await context.entities.SavedRule.upsert({
    create: {
      description: DEFAULT_RULE_DESCRIPTION,
      name: DEFAULT_RULE_NAME,
      ownerId,
      source: SAVED_STARTER_RULE,
      tags: ["starter", "powershell"],
    },
    select: { id: true },
    update: {},
    where: {
      ownerId_name: {
        name: DEFAULT_RULE_NAME,
        ownerId,
      },
    },
  })

  await context.entities.UdmEventSet.upsert({
    create: {
      description: DEFAULT_TEST_CASE_DESCRIPTION,
      events: DEFAULT_TEST_CASE_EVENTS,
      expectedResults: null,
      name: DEFAULT_TEST_CASE_NAME,
      ownerId,
      savedRuleId: defaultRule.id,
    },
    update: {
      savedRuleId: defaultRule.id,
    },
    where: {
      ownerId_name: {
        name: DEFAULT_TEST_CASE_NAME,
        ownerId,
      },
    },
  })

  await context.entities.UserPreference.upsert({
    create: {
      key: STARTER_LIBRARY_SEEDED_PREFERENCE_KEY,
      ownerId,
      value: true,
    },
    update: {
      value: true,
    },
    where: {
      ownerId_key: {
        key: STARTER_LIBRARY_SEEDED_PREFERENCE_KEY,
        ownerId,
      },
    },
  })
}

export const saveUdmEventSet: SaveUdmEventSet<
  SaveUdmEventSetArgs,
  UdmEventSetRecord
> = async (args, context) => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  const data = { ...normalizeUdmEventSet(args, createHttpError), ownerId }
  if (data.savedRuleId) {
    const ownedSavedRule = await context.entities.SavedRule.findFirst({
      select: { id: true },
      where: { id: data.savedRuleId, ownerId },
    })
    if (!ownedSavedRule) {
      throw new HttpError(400, "Linked saved rule was not found.")
    }
  }
  if (args.id) {
    const existingById = await context.entities.UdmEventSet.findFirst({
      select: { name: true },
      where: { id: args.id, ownerId },
    })
    if (!existingById) {
      throw new HttpError(404, "Test case not found.")
    }
    requireUnchangedImmutableName("Test case", existingById?.name, data.name, createHttpError)
  }
  const existingFixture = await context.entities.UdmEventSet.findFirst({
    where: { name: data.name, ownerId },
  })
  const updateId = args.id ?? existingFixture?.id ?? null
  if (updateId) {
    await requireFixtureEventLimit({
      createError: createHttpError,
      eventCount: data.events.length,
    })
    return context.entities.UdmEventSet.update({
      data,
      where: { id: updateId },
    })
  }

  await requireCanCreateLibraryResource({
    context,
    createError: createHttpError,
    ownerId,
    resource: "fixture",
  })
  await requireFixtureEventLimit({
    createError: createHttpError,
    eventCount: data.events.length,
  })
  return context.entities.UdmEventSet.create({ data })
}

export const deleteUdmEventSet: DeleteUdmEventSet<
  DeleteArgs,
  UdmEventSetRecord
> = async (args, context) => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  requireDeleteId(args, "UDM event set id is required.", createHttpError)
  const existingFixture = await context.entities.UdmEventSet.findFirst({
    where: { id: args.id, ownerId },
  })
  if (!existingFixture) {
    throw new HttpError(404, "UDM event set not found.")
  }

  return context.entities.UdmEventSet.delete({
    where: { id: args.id },
  })
}

export const getDataTables: GetDataTables<void, DataTableRecord[]> = async (_args, context) => {
  const ownerId = requireUserId(context)
  await requireAppAccess(context)

  return context.entities.DataTable.findMany({
    where: { ownerId },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  })
}

export const saveDataTable: SaveDataTable<SaveDataTableArgs, DataTableRecord> = async (
  args,
  context
) => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  const data = { ...normalizeDataTable(args, createHttpError), ownerId }
  if (args.id) {
    const existingById = await context.entities.DataTable.findFirst({
      select: { name: true },
      where: { id: args.id, ownerId },
    })
    if (!existingById) {
      throw new HttpError(404, "Data table not found.")
    }
    requireUnchangedImmutableName("Data table", existingById?.name, data.name, createHttpError)
  }
  const existingTable = await context.entities.DataTable.findFirst({
    where: { name: data.name, ownerId },
  })
  if (existingTable && existingTable.id !== args.id) {
    throw new HttpError(409, `A data table named "${data.name}" already exists.`)
  }

  if (args.id) {
    return context.entities.DataTable.update({
      data,
      where: { id: args.id },
    })
  }

  await requireCanCreateLibraryResource({
    context,
    createError: createHttpError,
    ownerId,
    resource: "dataTable",
  })
  return context.entities.DataTable.create({ data })
}

export const deleteDataTable: DeleteDataTable<DeleteArgs, DataTableRecord> = async (
  args,
  context
) => {
  const ownerId = requireUserId(context)
  await requireLibraryMutationRateLimit(context, ownerId)
  await requireAppAccess(context)
  requireDeleteId(args, "Data table id is required.", createHttpError)
  const existingTable = await context.entities.DataTable.findFirst({
    where: { id: args.id, ownerId },
  })
  if (!existingTable) {
    throw new HttpError(404, "Data table not found.")
  }

  return context.entities.DataTable.delete({
    where: { id: args.id },
  })
}
