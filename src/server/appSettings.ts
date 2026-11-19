import { HttpError } from "wasp/server"
import type {
  GetPublicAppSettings,
  UpdateAdminAppSettings,
} from "wasp/server/operations"
import {
  coerceStoredStatusPageUrl,
  coerceStoredSupportEmail,
  normalizeMaintenanceMessage,
  normalizeStatusPageUrl,
  normalizeSupportEmail,
} from "./appSettingsValidation"
import {
  DEFAULT_PRODUCTION_APP_SETTINGS,
  getDefaultAppSettingsForEnvironment,
} from "./appSettingsDefaults"
import { RATE_LIMITS, requireRateLimit } from "./rateLimit"

export type AppSettings = {
  apiAccessEnabled: boolean
  appAccessEnabled: boolean
  maintenanceMessage: string
  signupsEnabled: boolean
  statusPageUrl: string
  supportEmail: string
}

export type PublicAppSettings = AppSettings & {
  emailVerificationRequired: boolean
}

export type UpdateAdminAppSettingsArgs = Partial<AppSettings>

type AppSettingsContext = {
  entities: {
    AppSetting: any
    User?: any
  }
  user?: { id: string } | null
}

const APP_SETTINGS_KEY = "app"

export const DEFAULT_APP_SETTINGS: AppSettings = DEFAULT_PRODUCTION_APP_SETTINGS

export const getPublicAppSettings: GetPublicAppSettings<void, PublicAppSettings> = async (
  _args,
  context
) => toPublicAppSettings(await getAppSettings(context))

export const updateAdminAppSettings: UpdateAdminAppSettings<
  UpdateAdminAppSettingsArgs,
  AppSettings
> = async (args, context) => {
  const adminUserId = await requireAdminForSettings(context)
  await requireRateLimit({
    bucket: "admin-mutation",
    context,
    createError: (statusCode, message) => new HttpError(statusCode, message),
    key: adminUserId,
    ownerId: adminUserId,
    ...RATE_LIMITS.adminMutation,
  })
  const settings = normalizeAppSettings(args)
  const record = await context.entities.AppSetting.upsert({
    create: {
      key: APP_SETTINGS_KEY,
      value: settings,
    },
    update: {
      value: settings,
    },
    where: {
      key: APP_SETTINGS_KEY,
    },
  })
  return mergeAppSettings(record.value)
}

export async function getAppSettings(context: AppSettingsContext): Promise<AppSettings> {
  const record = await context.entities.AppSetting.findUnique({
    where: {
      key: APP_SETTINGS_KEY,
    },
  })
  return mergeAppSettings(record?.value)
}

export async function requireAppAccess(context: AppSettingsContext) {
  const settings = await getAppSettings(context)
  if (settings.appAccessEnabled) {
    return settings
  }
  if (context.user?.id && context.entities.User) {
    const user = await context.entities.User.findUnique({
      select: { isAdmin: true },
      where: { id: context.user.id },
    })
    if (user?.isAdmin) {
      return settings
    }
  }
  throw new HttpError(503, settings.maintenanceMessage || DEFAULT_APP_SETTINGS.maintenanceMessage)
}

function normalizeAppSettings(args: UpdateAdminAppSettingsArgs): AppSettings {
  const defaultSettings = getDefaultAppSettings()
  return {
    apiAccessEnabled: toBoolean(args.apiAccessEnabled, defaultSettings.apiAccessEnabled),
    appAccessEnabled: toBoolean(args.appAccessEnabled, defaultSettings.appAccessEnabled),
    maintenanceMessage: normalizeMaintenanceMessage(
      args.maintenanceMessage,
      defaultSettings.maintenanceMessage,
      createHttpError
    ),
    signupsEnabled: toBoolean(args.signupsEnabled, defaultSettings.signupsEnabled),
    statusPageUrl: normalizeStatusPageUrl(args.statusPageUrl, createHttpError),
    supportEmail: normalizeSupportEmail(args.supportEmail, createHttpError),
  }
}

function mergeAppSettings(value: unknown): AppSettings {
  const partial = isObject(value) ? value : {}
  const defaultSettings = getDefaultAppSettings()
  return {
    apiAccessEnabled: typeof partial.apiAccessEnabled === "boolean"
      ? partial.apiAccessEnabled
      : defaultSettings.apiAccessEnabled,
    appAccessEnabled: typeof partial.appAccessEnabled === "boolean"
      ? partial.appAccessEnabled
      : defaultSettings.appAccessEnabled,
    maintenanceMessage: typeof partial.maintenanceMessage === "string"
      ? partial.maintenanceMessage
      : defaultSettings.maintenanceMessage,
    signupsEnabled: typeof partial.signupsEnabled === "boolean"
      ? partial.signupsEnabled
      : defaultSettings.signupsEnabled,
    statusPageUrl: coerceStoredStatusPageUrl(partial.statusPageUrl),
    supportEmail: coerceStoredSupportEmail(partial.supportEmail),
  }
}

function getDefaultAppSettings() {
  return getDefaultAppSettingsForEnvironment()
}

function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  return {
    ...settings,
    emailVerificationRequired: false,
  }
}

async function requireAdminForSettings(context: AppSettingsContext) {
  if (!context.user) {
    throw new HttpError(401, "You must be logged in.")
  }
  const user = await context.entities.User?.findUnique({
    select: { isAdmin: true },
    where: { id: context.user.id },
  })
  if (!user?.isAdmin) {
    throw new HttpError(403, "Admin access required.")
  }
  return context.user.id
}

function toBoolean(value: boolean | undefined, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createHttpError(statusCode: number, message: string) {
  return new HttpError(statusCode, message)
}
