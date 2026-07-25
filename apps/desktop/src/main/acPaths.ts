import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Locating an Assetto Corsa install.
 *
 * Steam lets users move games to secondary libraries, so checking the default
 * path alone fails for plenty of people. We check the obvious locations, then
 * parse Steam's `libraryfolders.vdf` to find alternate drives. Manual selection
 * is always available as a fallback — this is convenience, not a hard dependency.
 */

const AC_FOLDER = join("steamapps", "common", "assettocorsa");

/** An AC root must contain content/tracks and content/cars to be usable. */
export function isAcRoot(candidate: string): boolean {
  try {
    return (
      statSync(candidate).isDirectory() &&
      existsSync(join(candidate, "content", "tracks")) &&
      existsSync(join(candidate, "content", "cars"))
    );
  } catch {
    return false;
  }
}

/** Steam roots from the usual per-platform locations. */
function candidateSteamRoots(): string[] {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return [
        "C:\\Program Files (x86)\\Steam",
        "C:\\Program Files\\Steam",
        "D:\\Steam",
        "D:\\SteamLibrary",
        "E:\\Steam",
        "E:\\SteamLibrary",
      ];
    case "darwin":
      return [join(home, "Library", "Application Support", "Steam")];
    default:
      return [
        join(home, ".steam", "steam"),
        join(home, ".local", "share", "Steam"),
      ];
  }
}

/**
 * Library paths listed in libraryfolders.vdf.
 *
 * Parsed with a regex rather than a full VDF parser: we only need the `path`
 * values, and a malformed file should degrade to "found nothing" rather than
 * throw.
 */
function librariesFromVdf(steamRoot: string): string[] {
  const vdf = join(steamRoot, "steamapps", "libraryfolders.vdf");
  if (!existsSync(vdf)) return [];
  try {
    const text = readFileSync(vdf, "utf8");
    const paths: string[] = [];
    const pattern = /"path"\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      paths.push(match[1]!.replace(/\\\\/g, "\\"));
    }
    return paths;
  } catch {
    return [];
  }
}

/** Best-effort auto-detection; null when nothing convincing is found. */
export function detectAcRoot(): string | null {
  const roots = candidateSteamRoots();
  const searched = new Set<string>();

  for (const steamRoot of roots) {
    if (searched.has(steamRoot)) continue;
    searched.add(steamRoot);

    const direct = join(steamRoot, AC_FOLDER);
    if (isAcRoot(direct)) return direct;

    for (const library of librariesFromVdf(steamRoot)) {
      const candidate = join(library, AC_FOLDER);
      if (isAcRoot(candidate)) return candidate;
    }
  }

  // Some people keep a non-Steam copy directly on a drive root.
  if (process.platform === "win32") {
    for (const drive of ["C:", "D:", "E:"]) {
      const candidate = join(`${drive}\\`, "assettocorsa");
      if (isAcRoot(candidate)) return candidate;
    }
  }

  return null;
}

/** Existing track folder ids, used to warn before overwriting. */
export function existingTrackIds(acRoot: string): string[] {
  try {
    return readdirSync(join(acRoot, "content", "tracks"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
