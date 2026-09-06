import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";

export class HybridSpooler {
  private inMemoryThreshold: number = 64 * 1024; // 64KB fast path
  private bufferSize: number = 0;
  private memoryBuffer: Buffer[] = [];

  private tempFilePath: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private maxBodySize: number;
  private truncated: boolean = false;

  constructor(maxBodySize: number = 2 * 1024 * 1024) {
    this.maxBodySize = maxBodySize;
  }

  public tee(chunk: Buffer) {
    if (this.truncated) return;

    this.bufferSize += chunk.length;
    if (this.bufferSize > this.maxBodySize) {
      this.truncated = true;
      return;
    }

    if (this.tempFilePath === null && this.bufferSize <= this.inMemoryThreshold) {
      // In-Memory Fast Path
      this.memoryBuffer.push(chunk);
    } else {
      // Conditional Disk Spillover
      if (this.tempFilePath === null) {
        this.tempFilePath = path.join(
          os.tmpdir(),
          `volten-spool-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
        );

        // Strict file permissions if not on windows
        const options = process.platform !== "win32" ? { mode: 0o600 } : {};
        this.writeStream = fs.createWriteStream(this.tempFilePath, options);
        this.writeStream.on("error", () => {
          this.truncated = true;
          this.writeStream = null;
        });

        // Spill over existing memory chunks
        for (const b of this.memoryBuffer) {
          this.writeStream.write(b);
        }
        this.memoryBuffer.length = 0;
      }

      if (this.writeStream !== null) {
        this.writeStream.write(chunk);
      }
    }
  }

  public async getPayload(): Promise<Buffer> {
    if (this.tempFilePath !== null && this.writeStream !== null) {
      this.writeStream.end();
      const ws = this.writeStream;
      await new Promise((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve(undefined);
          }
        };
        ws.on("finish", done).on("error", done).on("close", done);
      });
      this.writeStream = null;

      try {
        return await fsPromises.readFile(this.tempFilePath);
      } catch {
        return Buffer.alloc(0);
      }
    } else {
      return Buffer.concat(this.memoryBuffer);
    }
  }

  public async cleanup() {
    this.memoryBuffer.length = 0;
    this.bufferSize = 0;
    this.truncated = false;

    if (this.writeStream !== null) {
      this.writeStream.end();
      this.writeStream = null;
    }

    if (this.tempFilePath !== null) {
      try {
        await fsPromises.unlink(this.tempFilePath);
      } catch {
        // Ignore
      }
      this.tempFilePath = null;
    }
  }

  public static async sweep() {
    // Background sweep to clean up orphaned temp files
    try {
      const tmpDir = os.tmpdir();
      const files = await fsPromises.readdir(tmpDir);
      const now = Date.now();
      for (const file of files) {
        if (file.startsWith("volten-spool-")) {
          const filePath = path.join(tmpDir, file);
          const stats = await fsPromises.stat(filePath);
          // Delete if older than 1 hour
          if (now - stats.mtimeMs > 60 * 60 * 1000) {
            await fsPromises.unlink(filePath).catch(() => {});
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }
}
