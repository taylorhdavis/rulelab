export function parseYaralDurationMinutes(value: string) {
  const match = value.match(/^(\d+)([smhd])$/i)
  if (!match) {
    return null
  }

  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  return unit === "s"
    ? amount / 60
    : unit === "m"
      ? amount
      : unit === "h"
        ? amount * 60
        : amount * 24 * 60
}

export function getYaralDurationBoundsMessage(value: string, maxMinutes: number) {
  const minutes = parseYaralDurationMinutes(value)
  if (minutes === null) {
    return "Durations must use seconds, minutes, hours, or days, like `30s`, `5m`, `2h`, or `1d`."
  }

  if (minutes < 1) {
    return "Match windows must be at least 1 minute."
  }
  if (minutes > maxMinutes) {
    return `Match windows must not exceed ${formatDurationLimit(maxMinutes)}.`
  }
  return null
}

function formatDurationLimit(minutes: number) {
  if (minutes % 60 === 0) {
    return `${minutes / 60} hours`
  }
  return `${minutes} minutes`
}
