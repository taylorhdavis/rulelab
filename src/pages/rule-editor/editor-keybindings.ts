export type EditorKeybindingAction =
  | "commandPalette"
  | "dataTables"
  | "firstDiagnostic"
  | "format"
  | "library"
  | "newRule"
  | "save"
  | "testPanel"
  | "toggleWarnings"
  | "zoomIn"
  | "zoomOut"

type KeyEventLike = {
  altKey?: boolean
  ctrlKey?: boolean
  key: string
  metaKey?: boolean
  shiftKey?: boolean
}

export function getEditorKeybindingAction(event: KeyEventLike): EditorKeybindingAction | null {
  const key = event.key.toLowerCase()
  const mod = Boolean(event.metaKey || event.ctrlKey)
  const alt = Boolean(event.altKey)
  const shift = Boolean(event.shiftKey)

  if (mod && !alt && !shift && key === "s") return "save"
  if (mod && !alt && !shift && key === "k") return "commandPalette"
  if (mod && !alt && shift && key === "f") return "format"
  if (mod && !alt && !shift && key === "enter") return "testPanel"
  if (!mod && !alt && !shift && key === "f8") return "firstDiagnostic"
  if (mod && alt && !shift && key === "n") return "newRule"
  if (mod && alt && !shift && key === "l") return "library"
  if (mod && alt && !shift && key === "d") return "dataTables"
  if (mod && !alt && shift && key === "w") return "toggleWarnings"
  if (mod && !alt && !shift && (key === "=" || key === "+")) return "zoomIn"
  if (mod && !alt && !shift && key === "-") return "zoomOut"

  return null
}
