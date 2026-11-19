import helmet from "helmet"
import { passwordAuthMiddleware } from "./passwordAuth"
import type { MiddlewareConfigFn } from "wasp/server"

export const RULELAB_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'self'"],
  "frame-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "script-src-attr": ["'none'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'", "data:"],
  "connect-src": [
    "'self'",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "ws://localhost:*",
    "ws://127.0.0.1:*",
  ],
  "form-action": ["'self'"],
  "media-src": ["'self'"],
  "upgrade-insecure-requests": [],
}

export const securityHeadersMiddleware: MiddlewareConfigFn = (middlewareConfig) => {
  middlewareConfig.set("helmet", helmet({
    contentSecurityPolicy: {
      directives: RULELAB_CSP_DIRECTIVES,
    },
    crossOriginEmbedderPolicy: false,
  }))
  middlewareConfig.set("rulelab.passwordAuth", passwordAuthMiddleware)
  return middlewareConfig
}
