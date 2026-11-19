const SECTION_PATTERN = /^(meta|events|match|outcome|condition|options):\s*$/i

export function formatYaralRule(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  const formatted: string[] = []
  let inRuleBlock = false
  let inSection = false
  let inBlockComment = false
  let previousBlank = false

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()

    if (!trimmed) {
      if (!previousBlank && formatted.length > 0) {
        formatted.push("")
      }
      previousBlank = true
      continue
    }

    previousBlank = false

    if (inBlockComment) {
      const indent = inRuleBlock ? (inSection ? "    " : "  ") : ""
      formatted.push(`${indent}${trimmed}`)
      inBlockComment = getNextBlockCommentState(rawLine, inBlockComment)
      continue
    }

    if (/^rule\b/.test(trimmed)) {
      if (formatted.length > 0 && formatted.at(-1) !== "") {
        formatted.push("")
      }
      formatted.push(trimmed)
      inRuleBlock = trimmed.includes("{")
      inSection = false
      inBlockComment = getNextBlockCommentState(rawLine, inBlockComment)
      continue
    }

    if (trimmed === "{") {
      formatted.push("{")
      inRuleBlock = true
      inSection = false
      inBlockComment = getNextBlockCommentState(rawLine, inBlockComment)
      continue
    }

    if (trimmed === "}") {
      if (formatted.at(-1) === "") {
        formatted.pop()
      }
      formatted.push("}")
      inRuleBlock = false
      inSection = false
      inBlockComment = getNextBlockCommentState(rawLine, inBlockComment)
      continue
    }

    if (SECTION_PATTERN.test(trimmed)) {
      if (formatted.length > 0 && formatted.at(-1) !== "") {
        formatted.push("")
      }
      formatted.push(`${inRuleBlock ? "  " : ""}${trimmed.toLowerCase()}`)
      inSection = true
      inBlockComment = getNextBlockCommentState(rawLine, inBlockComment)
      continue
    }

    const indent = inRuleBlock ? (inSection ? "    " : "  ") : ""
    formatted.push(`${indent}${trimmed}`)
    inBlockComment = getNextBlockCommentState(rawLine, inBlockComment)
  }

  while (formatted.at(-1) === "") {
    formatted.pop()
  }

  return `${formatted.join("\n")}\n`
}

function getNextBlockCommentState(line: string, startsInsideComment: boolean) {
  let inComment = startsInsideComment
  let index = 0
  while (index < line.length) {
    const current = line[index]
    const next = line[index + 1]
    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false
        index += 2
        continue
      }
      index += 1
      continue
    }
    if (current === "/" && next === "*") {
      inComment = true
      index += 2
      continue
    }
    if (current === "/" && next === "/") {
      break
    }
    if (current === "\"" || current === "`") {
      index = skipQuotedText(line, index, current)
      continue
    }
    index += 1
  }
  return inComment
}

function skipQuotedText(line: string, startIndex: number, quote: string) {
  let index = startIndex + 1
  while (index < line.length) {
    const current = line[index]
    if (current === "\\") {
      index += 2
      continue
    }
    if (current === quote) {
      return index + 1
    }
    index += 1
  }
  return index
}
