import path from "path";
import fs from "fs/promises";

export async function isFileInFolder(folderPath: string, filePath: string): Promise<boolean> {
  try {
    const realFolderPath = await fs.realpath(path.resolve(folderPath));
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(realFolderPath, filePath);
    }
    const realFilePath = await fs.realpath(path.resolve(filePath));
    const relative = path.relative(realFolderPath, realFilePath);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
