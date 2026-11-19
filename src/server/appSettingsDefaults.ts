export type AppSettingsDefaults = {
  apiAccessEnabled: boolean
  appAccessEnabled: boolean
  maintenanceMessage: string
  signupsEnabled: boolean
  statusPageUrl: string
  supportEmail: string
}

export const DEFAULT_PRODUCTION_APP_SETTINGS: AppSettingsDefaults = {
  apiAccessEnabled: false,
  appAccessEnabled: true,
  maintenanceMessage: "RuleLab is temporarily unavailable while maintenance is in progress.",
  signupsEnabled: true,
  statusPageUrl: "",
  supportEmail: "",
}

export const DEFAULT_DEV_APP_SETTINGS: AppSettingsDefaults = {
  ...DEFAULT_PRODUCTION_APP_SETTINGS,
  apiAccessEnabled: true,
  signupsEnabled: true,
}

export function getDefaultAppSettingsForEnvironment(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production" ? DEFAULT_PRODUCTION_APP_SETTINGS : DEFAULT_DEV_APP_SETTINGS
}
