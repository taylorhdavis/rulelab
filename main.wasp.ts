/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { action, api, app, page, query, route } from "@wasp.sh/spec"

import { Root } from "./src/app/Root" with { type: "ref" }
import { NotFoundPage } from "./src/pages/NotFoundPage" with { type: "ref" }
import { AdminDashboardPage } from "./src/pages/admin/AdminDashboardPage" with { type: "ref" }
import {
  LoginPage,
  PasswordResetPage,
  RequestPasswordResetPage,
  SignupPage,
} from "./src/pages/auth/AuthPage" with { type: "ref" }
import { PrivacyPolicyPage } from "./src/pages/legal/PrivacyPolicyPage" with { type: "ref" }
import { TermsOfServicePage } from "./src/pages/legal/TermsOfServicePage" with { type: "ref" }
import { ProfilePage } from "./src/pages/profile/ProfilePage" with { type: "ref" }
import { RuleEditorPage } from "./src/pages/rule-editor/RuleEditorPage" with { type: "ref" }
import { ApiDocsPage } from "./src/pages/docs/ApiDocsPage" with { type: "ref" }
import { createApiKey, listApiKeys, renameApiKey, revokeApiKey } from "./src/server/apiKeys" with { type: "ref" }
import {
  createAdminUser,
  deleteAdminDataTable,
  deleteAdminSavedRule,
  deleteAdminUdmEventSet,
  deleteAdminUser,
  getAdminDashboardData,
  updateAdminUser,
} from "./src/server/adminDashboard" with { type: "ref" }
import { getPublicAppSettings, updateAdminAppSettings } from "./src/server/appSettings" with { type: "ref" }
import { onBeforeSignup } from "./src/server/authHooks" with { type: "ref" }
import {
  getPasswordResetEmailContent,
  getVerificationEmailContent,
} from "./src/server/authEmails" with { type: "ref" }
import {
  requestRulelabPasswordReset,
  resetRulelabPassword,
} from "./src/server/passwordReset" with { type: "ref" }
import { deleteAccount, getProfileData, updatePassword } from "./src/server/profile" with { type: "ref" }
import {
  compileYaralApi,
  createRuleApi,
  deleteRuleApi,
  formatYaralApi,
  getRuleApi,
  listRulesApi,
  publicApiMiddleware,
  testYaralApi,
  updateRuleApi,
  validateYaralApi,
} from "./src/server/publicApi" with { type: "ref" }
import {
  deleteDataTable,
  deleteRule,
  deleteUdmEventSet,
  getDataTables,
  getSavedRules,
  getSavedRuleVersions,
  getUdmEventSets,
  restoreSavedRuleVersion,
  saveDataTable,
  saveRule,
  saveUdmEventSet,
} from "./src/server/ruleLibrary" with { type: "ref" }
import { securityHeadersMiddleware } from "./src/server/securityHeaders" with { type: "ref" }
import { serverSetup } from "./src/server/setup" with { type: "ref" }
import { getEditorTutorialStatus, markEditorTutorialSeen } from "./src/server/userPreferences" with { type: "ref" }

export default app({
  name: "rulelab",
  wasp: {
    version: "^0.24.0",
  },
  title: "RuleLab — Local YARA-L Editor",
  emailSender: {
    provider: "Mailgun",
  },
  head: [
    "<link rel='icon' type='image/svg+xml' href='/brand/rulelab-mark.svg' />",
    "<link rel='alternate icon' type='image/svg+xml' href='/favicon.svg' />",
    "<link rel='manifest' href='/site.webmanifest' />",
    "<meta name='description' content='Open-source YARA-L 2.0 rule editor, validator, and local evaluator.' />",
    "<meta name='application-name' content='RuleLab' />",
    "<meta name='robots' content='index,follow' />",
    "<meta name='theme-color' content='#111111' />",
    "<meta name='color-scheme' content='dark' />",
  ],
  auth: {
    userEntity: "User",
    methods: {
      email: {
        fromField: {
          name: "RuleLab",
          email: "noreply@example.com",
        },
        // Required Wasp metadata; passwordAuthMiddleware disables the verification flow.
        emailVerification: {
          clientRoute: "LoginRoute",
          getEmailContentFn: getVerificationEmailContent,
        },
        passwordReset: {
          clientRoute: "PasswordResetRoute",
          getEmailContentFn: getPasswordResetEmailContent,
        },
      },
    },
    onAuthFailedRedirectTo: "/login",
    onBeforeSignup,
  },
  client: {
    rootComponent: Root,
  },
  server: {
    setupFn: serverSetup,
    middlewareConfigFn: securityHeadersMiddleware,
  },
  spec: [
    route("RootRoute", "/", page(LoginPage)),
    route("LoginRoute", "/login", page(LoginPage)),
    route("SignupRoute", "/signup", page(SignupPage)),
    route("RequestPasswordResetRoute", "/request-password-reset", page(RequestPasswordResetPage)),
    route("PasswordResetRoute", "/password-reset", page(PasswordResetPage)),
    route("EditorRoute", "/editor", page(RuleEditorPage)),
    route("AdminRoute", "/admin", page(AdminDashboardPage)),
    route("ProfileRoute", "/profile", page(ProfilePage)),
    route("ProfileApiRoute", "/profile/api", page(ProfilePage)),
    route("ProfileSecurityRoute", "/profile/security", page(ProfilePage)),
    route("TermsRoute", "/terms", page(TermsOfServicePage), { prerender: true }),
    route("PrivacyPolicyRoute", "/privacy-policy", page(PrivacyPolicyPage), { prerender: true }),
    route("ApiDocsRoute", "/api-docs", page(ApiDocsPage), { prerender: true }),
    route("NotFoundRoute", "*", page(NotFoundPage)),

    query(getSavedRules, { entities: ["User", "AppSetting", "SavedRule", "UdmEventSet", "UserPreference"] }),
    action(saveRule, { entities: ["User", "AppSetting", "SavedRule", "SavedRuleVersion"] }),
    action(deleteRule, { entities: ["User", "AppSetting", "SavedRule"] }),
    query(getSavedRuleVersions, { entities: ["User", "AppSetting", "SavedRule", "SavedRuleVersion"] }),
    action(restoreSavedRuleVersion, { entities: ["User", "AppSetting", "SavedRule", "SavedRuleVersion"] }),
    query(getUdmEventSets, { entities: ["User", "AppSetting", "SavedRule", "UdmEventSet", "UserPreference"] }),
    action(saveUdmEventSet, { entities: ["User", "AppSetting", "UdmEventSet", "SavedRule"] }),
    action(deleteUdmEventSet, { entities: ["User", "AppSetting", "UdmEventSet"] }),
    query(getDataTables, { entities: ["User", "AppSetting", "DataTable"] }),
    action(saveDataTable, { entities: ["User", "AppSetting", "DataTable"] }),
    action(deleteDataTable, { entities: ["User", "AppSetting", "DataTable"] }),
    query(getAdminDashboardData, {
      entities: ["User", "AppSetting", "SavedRule", "UdmEventSet", "DataTable", "ApiKey", "ApiRateLimit"],
    }),
    query(getPublicAppSettings, { entities: ["AppSetting"] }),
    query(getProfileData, { entities: ["User", "SavedRule", "UdmEventSet", "DataTable"] }),
    query(getEditorTutorialStatus, { entities: ["UserPreference"] }),
    action(markEditorTutorialSeen, { entities: ["UserPreference"] }),
    action(updateAdminAppSettings, { entities: ["User", "AppSetting"] }),
    action(updateAdminUser, { entities: ["User"] }),
    action(createAdminUser, { entities: ["User"] }),
    action(deleteAdminUser, { entities: ["User", "SavedRule", "UdmEventSet", "DataTable"] }),
    action(deleteAdminSavedRule, { entities: ["User", "SavedRule"] }),
    action(deleteAdminUdmEventSet, { entities: ["User", "UdmEventSet"] }),
    action(deleteAdminDataTable, { entities: ["User", "DataTable"] }),
    action(updatePassword, { entities: ["User", "ApiRateLimit"] }),
    action(deleteAccount, { entities: ["User", "SavedRule", "UdmEventSet", "DataTable", "ApiKey", "ApiRateLimit"] }),
    query(listApiKeys, { entities: ["User", "ApiKey"] }),
    action(createApiKey, { entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit"] }),
    action(renameApiKey, { entities: ["User", "ApiKey", "ApiRateLimit"] }),
    action(revokeApiKey, { entities: ["User", "ApiKey", "ApiRateLimit"] }),
    api("POST", "/auth/email/request-rulelab-password-reset", requestRulelabPasswordReset, {
      auth: false,
    }),
    api("POST", "/auth/email/reset-rulelab-password", resetRulelabPassword, {
      auth: false,
    }),
    api("POST", "/api/v1/yaral/compile", compileYaralApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("POST", "/api/v1/yaral/validate", validateYaralApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("POST", "/api/v1/yaral/format", formatYaralApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("POST", "/api/v1/yaral/test", testYaralApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("GET", "/api/v1/rules", listRulesApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit", "SavedRule"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("POST", "/api/v1/rules", createRuleApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit", "SavedRule"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("GET", "/api/v1/rules/:id", getRuleApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit", "SavedRule"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("PUT", "/api/v1/rules/:id", updateRuleApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit", "SavedRule"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
    api("DELETE", "/api/v1/rules/:id", deleteRuleApi, {
      entities: ["User", "AppSetting", "ApiKey", "ApiRateLimit", "SavedRule"],
      auth: false,
      middlewareConfigFn: publicApiMiddleware,
    }),
  ],
})
