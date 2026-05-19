import path from "path";
export function isFileInFolder(folderPath: string, filePath: string): boolean {
  const absoluteFolder = path.resolve(folderPath);
  const absoluteFile = path.resolve(filePath);
  return absoluteFile.startsWith(absoluteFolder + path.sep);
}
