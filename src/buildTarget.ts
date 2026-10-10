/**
 * Which ConjureOS project this build was made for. The committed value is "prod", so a build that skipped the stamping step is
 * still right for real players. The publish workflow (.github/workflows/publish-store.yml, "Stamp games-db backend URL") rewrites
 * the value to "dev" when it publishes to the dev project. Nothing else edits this file, and nothing reads package.json for it
 * (the shell's bundler rewrites the conjureos block there).
 *
 * What reads it: the game host decides from it whether the two test rooms show on the start screen.
 */
export const BUILD_TARGET: "prod" | "dev" = "prod";
