export const STARTER_LIBRARY_SEEDED_PREFERENCE_KEY = "starterLibrarySeeded"

export function shouldSeedStarterLibrary(starterPreference: unknown) {
  return !starterPreference
}
