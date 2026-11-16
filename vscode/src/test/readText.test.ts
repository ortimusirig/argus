import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { decode, readText } from "../core/readText";
import { NoteIndex } from "../core/noteIndex";
import { parseProps } from "../core/notes";

const NOTE = "---\r\ntype: concept\r\nwritten_by: argus\r\n---\r\n# Café € 😀\rText.\n";

function utf16(text: string, big: boolean): Buffer {
  const body = Buffer.from(text, "utf16le");
  if (big) { body.swap16(); }
  return Buffer.concat([Buffer.from(big ? [0xfe, 0xff] : [0xff, 0xfe]), body]);
}

test("a file is decoded as read_text decodes it: UTF-8 with or without a mark, UTF-16 with a mark, else Windows-1252", () => {
  assert.deepEqual(decode(Buffer.from(NOTE, "utf8")), { text: NOTE, encoding: "utf-8" });
  assert.deepEqual(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NOTE, "utf8")])), { text: NOTE, encoding: "utf-8 with BOM" });
  assert.deepEqual(decode(utf16(NOTE, false)), { text: NOTE, encoding: "utf-16" });
  assert.deepEqual(decode(utf16(NOTE, true)), { text: NOTE, encoding: "utf-16" });
  assert.deepEqual(decode(Buffer.from([])), { text: "", encoding: "utf-8" });
  // Not UTF-8: Windows-1252, and the five bytes it has no character for are U+FFFD (not the C1 controls).
  assert.deepEqual(decode(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x9f, 0x0d, 0x0a])),
    { text: "café €�����Ÿ\r\n", encoding: "windows-1252 (assumed)" });
  // With a mark, what is not valid is replaced, never a reason to guess another encoding.
  assert.deepEqual(decode(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xff, 0x62])), { text: "a�b", encoding: "utf-8 with BOM" });
  assert.deepEqual(decode(Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x00, 0xd8, 0x62, 0x00, 0x00, 0xdc, 0x63])),
    { text: "a�b��", encoding: "utf-16" });
  // Only the first mark is the file's; a second one is a character of the text. Line endings are left as they are.
  assert.equal(decode(Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x0d])).text, "﻿\r");
});

test("a UTF-16 note, and a Windows-1252 note, are notes to the index as they are to the checker", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argus-read-"));
  try {
    const notes = path.join(root, "notes");
    fs.mkdirSync(notes);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(notes, "Concept - wide.md"), utf16(NOTE, false));
    fs.writeFileSync(path.join(notes, "Concept - big.md"), utf16(NOTE, true));
    fs.writeFileSync(path.join(notes, "Concept - old.md"),
      Buffer.concat([Buffer.from("---\ntype: concept\nwritten_by: argus\n---\ncaf", "latin1"), Buffer.from([0xe9, 0x0a])]));
    fs.writeFileSync(path.join(notes, "Concept - marked.md"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NOTE, "utf8")]));
    assert.equal((await readText(path.join(notes, "Concept - wide.md"))).text, NOTE);
    const project = { sourceRoot: path.join(root, "src"), notesFolder: notes };
    const index = new NoteIndex();
    index.setProjects([project]);
    await index.refreshNow(project);
    assert.deepEqual(index.notesOf(project, "notes").map((e) => e.name).sort(),
      ["Concept - big", "Concept - marked", "Concept - old", "Concept - wide"]);
    assert.equal(index.notesByName("Concept - wide")[0].text, NOTE);
    assert.ok(index.notesByName("Concept - old")[0].other?.body.includes("café"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the mark is the reader's to drop: a text that still starts with one does not start with ---", () => {
  assert.equal(parseProps("---\ntype: concept\nwritten_by: argus\n---\n").writtenBy, "argus");
  assert.notEqual(parseProps("﻿---\ntype: concept\nwritten_by: argus\n---\n").writtenBy, "argus");
});

const python = spawnSync("python", ["--version"], { encoding: "utf8" });
const noPython = python.error || python.status !== 0 ? "Python ('python') was not found; the parity test with _common.py did not run" : false;

/** Byte strings that try every branch of read_text: fixed cases, then many made by a small generator of its own
 *  (the same each run), from pieces that are valid and pieces that are not. */
function samples(): Buffer[] {
  const marks = [[], [0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff], [0xef, 0xbb], [0xff], [0xfe]];
  const pieces = [[0x61], [0x0d, 0x0a], [0x0d], [0x0a], [0xc3, 0xa9], [0xe2, 0x82, 0xac], [0xf0, 0x9f, 0x98, 0x80], [0xe2, 0x82], [0xf0, 0x9f, 0x98],
    [0xed, 0xa0, 0x80], [0xc0, 0xaf], [0xf5, 0x80], [0x80], [0x81], [0x8d], [0x8f], [0x90], [0x9d], [0x9f], [0xff], [0xfe], [0xef, 0xbb, 0xbf], [0xff, 0xfe],
    [0xfe, 0xff], [0x00, 0xd8], [0xd8, 0x00], [0x00, 0xdc], [0xdc, 0x00], [0x3d, 0xd8, 0x00, 0xde], [0xd8, 0x3d, 0xde, 0x00], [0x00], [0x00, 0x00], [0x28, 0x20],
    [0x20, 0x28], [0x85], [0xa0], [0x2d, 0x2d, 0x2d]];
  const out: Buffer[] = [];
  for (const mark of marks) {
    out.push(Buffer.from(mark));
    for (const piece of pieces) { out.push(Buffer.from([...mark, ...piece])); out.push(Buffer.from([...mark, 0x61, 0x00, ...piece, 0x62])); }
  }
  let seed = 12345;
  const next = (below: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % below; };
  for (let n = 0; n < 1500; n++) {
    const bytes: number[] = [...marks[next(marks.length)]];
    for (let k = next(12); k > 0; k--) { bytes.push(...pieces[next(pieces.length)]); }
    out.push(Buffer.from(bytes));
  }
  for (let n = 0; n < 500; n++) {
    const bytes: number[] = [...marks[next(4)]];
    for (let k = next(40); k > 0; k--) { bytes.push(next(256)); }
    out.push(Buffer.from(bytes));
  }
  return out;
}

test("decode gives what read_text in _common.py gives, text and encoding name", { skip: noPython }, (t) => {
  const all = samples();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-read-"));
  try {
    const list = path.join(tmp, "samples.json");
    fs.writeFileSync(list, JSON.stringify(all.map((b) => b.toString("hex"))), "utf8");
    // read_text is given real files: one file, written anew for each sample.
    const program = ["import json, sys", "sys.path.insert(0, sys.argv[1])", "from _common import read_text", "from pathlib import Path",
      "out = []", "p = Path(sys.argv[3])", "for h in json.load(open(sys.argv[2], encoding='utf-8')):",
      "    p.write_bytes(bytes.fromhex(h))", "    out.append(list(read_text(p)))", "print(json.dumps(out))"].join("\n");
    const out = spawnSync("python", ["-B", "-c", program, path.resolve(__dirname, "../../../skills/argus/scripts"), list, path.join(tmp, "sample.bin")],
      { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.equal(out.status, 0, out.stderr);
    const answers = JSON.parse(out.stdout) as [string, string][];
    assert.equal(answers.length, all.length);
    const seen = new Set<string>();
    all.forEach((bytes, n) => {
      const mine = decode(bytes);
      seen.add(mine.encoding);
      assert.deepEqual([mine.text, mine.encoding], answers[n], `bytes ${bytes.toString("hex")}`);
    });
    assert.deepEqual([...seen].sort(), ["utf-16", "utf-8", "utf-8 with BOM", "windows-1252 (assumed)"]);
    t.diagnostic(`${all.length} byte strings read as read_text reads them`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
