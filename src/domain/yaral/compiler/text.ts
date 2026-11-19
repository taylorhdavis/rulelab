export function stripYaralStringQuotes(value: string) {
  return value
    .replace(/^"|"$/g, "")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
}
