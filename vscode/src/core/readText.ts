// Reads a file's text as the checker reads it: `read_text` in skills/argus/scripts/_common.py is the definition,
// and each branch here is one of its branches, in its order. No import of "vscode".

import * as fs from "node:fs";

export interface Read { text: string; encoding: string; }

const REPLACED = "�";

// Python's cp1252: the characters of bytes 0x80 to 0x9F. Five bytes have none there, and `errors="replace"` gives
// U+FFFD for them (the "windows-1252" of browsers gives the C1 controls instead, so TextDecoder is not used).
const CP1252_HIGH = "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž�"
  + "�‘’“”•–—˜™š›œ�žŸ";

function cp1252(data: Buffer): string {
  return data.toString("latin1").replace(/[\x80-\x9f]/g, (c) => CP1252_HIGH[c.charCodeAt(0) - 0x80]);
}

/** As `bytes.decode("utf-16", errors="replace")` on data that starts with a mark: the mark says the byte order
 *  and is no part of the text; a surrogate without its other half is U+FFFD; so is a last byte without a second;
 *  a high surrogate at the very end, with or without such a byte after it, is one U+FFFD. */
function utf16(data: Buffer): string {
  const big = data[0] === 0xfe;
  const even = data.length - (data.length % 2);
  let units = data.subarray(2, even);
  if (big) { units = Buffer.from(units).swap16(); }          // a copy: the caller's bytes stay as they are
  const text = units.toString("utf16le");
  const cut = data.length % 2 === 1;
  const last = text.length > 0 ? text.charCodeAt(text.length - 1) : 0;
  const open = last >= 0xd800 && last <= 0xdbff;             // the text ends in a high surrogate
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, REPLACED)
    + (cut && !open ? REPLACED : "");
}

/** The text of a file's bytes and the name of the encoding, as `read_text` gives them: UTF-8 with a mark, UTF-16
 *  with a mark (what is not valid is replaced by U+FFFD in both), UTF-8 when the bytes are valid UTF-8, else
 *  Windows-1252. Line endings are left as they are; the callers turn them into "\n" as the checker's callers do. */
export function decode(bytes: Uint8Array): Read {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return { text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(data.subarray(3)), encoding: "utf-8 with BOM" };
  }
  if (data.length >= 2 && ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))) {
    return { text: utf16(data), encoding: "utf-16" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data), encoding: "utf-8" };
  } catch {
    return { text: cp1252(data), encoding: "windows-1252 (assumed)" };
  }
}

/** The file's text and the name of the encoding it was read in. A file that cannot be read throws. */
export async function readText(file: string): Promise<Read> {
  return decode(await fs.promises.readFile(file));
}
