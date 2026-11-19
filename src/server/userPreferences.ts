import { HttpError } from "wasp/server"
import type {
  GetEditorTutorialStatus,
  MarkEditorTutorialSeen,
} from "wasp/server/operations"

const EDITOR_TUTORIAL_PREFERENCE_KEY = "rule-editor-tutorial:v1"

type UserPreferenceContext = {
  entities: {
    UserPreference: any
  }
  user?: { id: string } | null
}

export type EditorTutorialStatus = {
  seen: boolean
}

export const getEditorTutorialStatus: GetEditorTutorialStatus<void, EditorTutorialStatus> = async (
  _args,
  context
) => {
  const ownerId = requireUserId(context)
  const preference = await context.entities.UserPreference.findUnique({
    where: {
      ownerId_key: {
        key: EDITOR_TUTORIAL_PREFERENCE_KEY,
        ownerId,
      },
    },
  })

  return { seen: isSeenPreferenceValue(preference?.value) }
}

export const markEditorTutorialSeen: MarkEditorTutorialSeen<void, EditorTutorialStatus> = async (
  _args,
  context
) => {
  const ownerId = requireUserId(context)
  await context.entities.UserPreference.upsert({
    create: {
      key: EDITOR_TUTORIAL_PREFERENCE_KEY,
      ownerId,
      value: { seenAt: new Date().toISOString() },
    },
    update: {
      value: { seenAt: new Date().toISOString() },
    },
    where: {
      ownerId_key: {
        key: EDITOR_TUTORIAL_PREFERENCE_KEY,
        ownerId,
      },
    },
  })

  return { seen: true }
}

function requireUserId(context: { user?: { id: string } | null }) {
  if (!context.user?.id) {
    throw new HttpError(401, "You must be signed in.")
  }
  return context.user.id
}

function isSeenPreferenceValue(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "seenAt" in value &&
      typeof (value as { seenAt?: unknown }).seenAt === "string"
  )
}
