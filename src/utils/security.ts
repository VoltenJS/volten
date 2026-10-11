import path from "path";
import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import type { Stats } from "fs";

export async function isFileInFolder(folderPath: string, filePath: string): Promise<boolean> {
  try {
    const realFolderPath = await fs.realpath(path.resolve(folderPath));
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(realFolderPath, filePath);
    }
    const realFilePath = await fs.realpath(path.resolve(filePath));
    return isInside(realFolderPath, realFilePath);
  } catch {
    return false;
  }
}

function isInside(realRoot: string, realFile: string): boolean {
  const relative = path.relative(realRoot, realFile);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

export interface OpenedFile {
  handle: fs.FileHandle;
  stats: Stats;
  realPath: string;
}

/**
 * Opens `filePath` for reading, guaranteeing that the OPENED file object lives inside `root`.
 *
 * Strategy (open-then-validate rather than validate-then-open):
 *  1. resolve root and target with realpath and check containment,
 *  2. open the resolved path with O_NOFOLLOW (the final component cannot be swapped for a symlink),
 *  3. fstat the descriptor (type/size come from the opened object, not a second path lookup),
 *  4. re-resolve the path and require that it still points to the same dev/ino inside root.
 *
 * Residual limitation: without openat2(RESOLVE_BENEATH) (not exposed by Node) an attacker with
 * write access INSIDE the served root could still swap an intermediate directory between steps 1
 * and 2. Step 4 detects such a swap when it is still in effect after the open.
 *
 * Returns null when the file does not exist, is not a regular file, or escapes the root.
 */
export async function openContainedFile(
  root: string,
  filePath: string,
): Promise<OpenedFile | null> {
  let handle: fs.FileHandle | null = null;
  try {
    if (filePath.includes("\0")) return null;
    const realRoot = await fs.realpath(path.resolve(root));
    const target = path.isAbsolute(filePath) ? filePath : path.join(realRoot, filePath);
    const realPath = await fs.realpath(path.resolve(target));
    if (!isInside(realRoot, realPath)) return null;

    const noFollow = fsConstants.O_NOFOLLOW;
    handle = await fs.open(realPath, fsConstants.O_RDONLY | noFollow);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return null;
    }

    const again = await fs.realpath(realPath);
    const afterStats = await fs.stat(again);
    if (
      again !== realPath ||
      !isInside(realRoot, again) ||
      afterStats.ino !== stats.ino ||
      afterStats.dev !== stats.dev
    ) {
      await handle.close();
      return null;
    }
    return { handle, stats, realPath };
  } catch {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}
