type BootstrapConfig = { enabled: boolean; email: string; password: string }
type BootstrapTransaction = {
  isComplete: () => Promise<boolean>
  markComplete: () => Promise<void>
  findIdentity: (email: string) => Promise<{ isAdmin: boolean } | null>
  createAdmin: (email: string, providerData: string) => Promise<void>
}
export type DefaultAdminStore = {
  isComplete: () => Promise<boolean>
  transaction: (work: (tx: BootstrapTransaction) => Promise<void>) => Promise<void>
}
export const DEFAULT_ADMIN_SETUP_KEY = "default-admin-bootstrap-v1"

export function getDefaultAdminConfig(env: NodeJS.ProcessEnv = process.env): BootstrapConfig {
  return {
    enabled: env.RULELAB_DEFAULT_ADMIN_ENABLED === "true",
    email: env.RULELAB_DEFAULT_ADMIN_EMAIL ?? "",
    password: env.RULELAB_DEFAULT_ADMIN_PASSWORD ?? "",
  }
}

export async function bootstrapDefaultAdmin(
  config: BootstrapConfig,
  store: DefaultAdminStore,
  prepareProviderData: (password: string) => Promise<string>
) {
  if (!config.enabled || await store.isComplete()) return
  const email = config.email.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Configure a valid RULELAB_DEFAULT_ADMIN_EMAIL before enabling the default administrator.")
  }
  if (config.password.length < 12 || config.password.length > 128 || !/\d/.test(config.password)) {
    throw new Error("Default admin password must contain 12–128 characters including a number.")
  }
  try {
    await store.transaction(async (tx) => {
      if (await tx.isComplete()) return
      const identity = await tx.findIdentity(email)
      if (identity && !identity.isAdmin) {
        throw new Error("Default admin email already belongs to a regular account; choose another address.")
      }
      // Commit this marker atomically with account creation. It survives deletion.
      await tx.markComplete()
      if (!identity) await tx.createAdmin(email, await prepareProviderData(config.password))
    })
  } catch (error) {
    // Another instance may have completed bootstrap while this transaction waited.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002" && await store.isComplete()) return
    throw error
  }
}
