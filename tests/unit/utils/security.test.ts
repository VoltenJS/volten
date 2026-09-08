import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isFileInFolder } from "../../../src/utils/security.ts";
// =====================================================================
// Unit tests for isFileInFolder (src/utils/security.ts)
// =====================================================================
//
// These tests build a real on-disk fixture tree under os.tmpdir() so
// that `fs.realpath` succeeds on every input. Without real files, the
// implementation's try/catch would short-circuit to `false` and the
// assertions would pass for the wrong reasons.

async function makeTree(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "volten-security-"));
  // root/
  //   public/
  //     file.txt
  //     sub/file.txt
  //   public-evil/file.txt
  //   secret.txt
  await mkdir(path.join(root, "public", "sub"), { recursive: true });
  await mkdir(path.join(root, "public-evil"), { recursive: true });
  await writeFile(path.join(root, "public", "file.txt"), "ok");
  await writeFile(path.join(root, "public", "sub", "file.txt"), "ok");
  await writeFile(path.join(root, "public-evil", "file.txt"), "evil");
  await writeFile(path.join(root, "secret.txt"), "secret");

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("Security Unit Tests", async (t) => {
  await t.test("file inside folder is allowed", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    assert.equal(
      await isFileInFolder(path.join(root, "public"), path.join(root, "public", "file.txt")),
      true,
    );
  });

  await t.test("file in nested subfolder is allowed", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    assert.equal(
      await isFileInFolder(path.join(root, "public"), path.join(root, "public", "sub", "file.txt")),
      true,
    );
  });

  await t.test("relative paths inside the folder are allowed", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    assert.equal(await isFileInFolder(path.join(root, "public"), "sub/file.txt"), true);
  });

  await t.test("directory-traversal escape is blocked", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    // path.resolve would normalize this and make it land outside
    assert.equal(
      await isFileInFolder(
        path.join(root, "public"),
        path.join(root, "public", "..", "secret.txt"),
      ),
      false,
    );
  });

  await t.test("completely different folder is blocked", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    assert.equal(
      await isFileInFolder(path.join(root, "public"), path.join(root, "secret.txt")),
      false,
    );
  });

  await t.test("same prefix but different folder is blocked", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    // public-evil must not be considered inside public
    assert.equal(
      await isFileInFolder(path.join(root, "public"), path.join(root, "public-evil", "file.txt")),
      false,
    );
  });

  await t.test("non-existent file returns false (realpath throws)", async (t) => {
    const { root, cleanup } = await makeTree();
    t.after(cleanup);
    assert.equal(
      await isFileInFolder(
        path.join(root, "public"),
        path.join(root, "public", "does-not-exist.txt"),
      ),
      false,
    );
  });
});
