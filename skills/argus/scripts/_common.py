"""Shared by the scripts: reading files and notes, which files count as source, scopes, graph paths, hashes."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

# Files that hold code a reader must have explained.
CODE_EXT = {
    ".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro", ".coffee",
    ".py", ".pyw", ".ipynb", ".rb", ".php", ".pl", ".pm", ".lua", ".r", ".jl",
    ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".m", ".mm", ".zig", ".nim", ".d",
    ".java", ".kt", ".kts", ".scala", ".groovy", ".gradle", ".cs", ".fs", ".vb", ".swift", ".dart",
    ".ex", ".exs", ".erl", ".hs", ".ml", ".clj", ".cljs", ".lisp", ".f90", ".pas", ".v", ".sv", ".sol",
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".bat", ".cmd",
    ".sql", ".html", ".htm", ".css", ".scss", ".sass", ".less", ".graphql", ".proto", ".tf", ".hcl",
}
# Files that are never counted as code: documents, data, settings, media, archives, generated files.
NOT_CODE_EXT = {
    ".md", ".txt", ".rst", ".adoc", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".lock", ".csv", ".tsv", ".xml", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".pdf",
    ".docx", ".xlsx", ".pptx", ".zip", ".gz", ".tar", ".7z", ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".wav", ".mov", ".map", ".log", ".pyc", ".class",
    ".o", ".a", ".lib", ".jar", ".whl", ".db", ".sqlite", ".pem", ".key", ".crt", ".cer", ".sig", ".tmp", ".bak",
    ".plist", ".snap", ".patch", ".diff", ".template", ".canvas", ".base",
}
# Folder names left out unless a scope names them (compared without regard to letter case).
SKIP_DIRS = {
    "node_modules", ".git", "venv", ".venv", "__pycache__", "dist", "build", "out", "download", "graphify-out",
    ".pytest_cache", "coverage", "vendor", ".claude", ".idea", ".vscode", "target", ".next", ".nuxt",
}
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs"}
# Files without an extension that hold code, by name (lower case).
CODE_NAMES = {"makefile", "gnumakefile", "dockerfile", "containerfile", "rakefile", "gemfile", "jenkinsfile",
              "vagrantfile", "justfile", "procfile", "brewfile", "cmakelists.txt"}
# Files without an extension that are documents, by name (lower case).
DOC_NAMES = {"license", "licence", "readme", "notice", "authors", "changelog", "contributors", "copying",
             "codeowners", "version", "patents"}
WINDOWS = os.name == "nt"


_WITNESS = hashlib.sha256()


def witness(*parts):
    """Adds something a run read or was told to the run's fingerprint. Every file read, every folder listing and
    every answer from git goes through here, so the fingerprint cannot miss an input: it is built from what the run
    actually used, not from a list someone has to keep complete."""
    # One JSON array per entry, one entry per line: no value, whatever characters it holds, can be mistaken for
    # two values or for another entry (JSON escapes line breaks and quotes).
    _WITNESS.update(json.dumps([str(p) for p in parts], ensure_ascii=True).encode("ascii") + b"\n")


def fingerprint():
    """The hash of everything witnessed so far in this run."""
    return _WITNESS.hexdigest()


def utf8_output():
    """Print in UTF-8 whatever the console's code page, so a non-ASCII name in a message cannot stop the run."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, ValueError):
            pass


def read_text(path):
    """(text, encoding name). Reads UTF-8 with or without a mark, UTF-16 with a mark, and falls back to
    Windows-1252 for anything else, so a file is compared as an editor would show it."""
    try:
        data = Path(path).read_bytes()
    except OSError as error:
        # A read that fails is an input too: "missing" and "not allowed" lead to different results.
        witness("read failed", path, type(error).__name__, error.errno, error.strerror)
        raise
    witness("read", path, hashlib.sha256(data).hexdigest())
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace"), "utf-8 with BOM"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace"), "utf-16"
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace"), "windows-1252 (assumed)"


def source_lines(path):
    """(lines, encoding). Line endings removed; one trailing empty line dropped."""
    text, encoding = read_text(path)
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines, encoding


def is_test_file(name):
    """A test by its file name, wherever it lies."""
    n = name.lower()
    stem = n.split(".")[0]
    return (stem.endswith("_test") or stem.startswith("test_") or ".test." in n or ".spec." in n
            or stem.endswith("_spec") or n == "conftest.py")


def kind_of(path):
    """'code', 'other' (documents, data, settings, media) or a label for a kind this check does not know."""
    name = path.name.lower()
    if name in CODE_NAMES:
        return "code"
    ext = path.suffix.lower()
    dotfile = name.startswith(".") and name.count(".") == 1
    if not dotfile and ext in CODE_EXT:
        return "code"
    if not dotfile and ext in NOT_CODE_EXT:
        return "other"
    if not dotfile and ext:
        return ext
    if name in DOC_NAMES:
        return "other"
    try:
        with open(path, "rb") as handle:
            start = handle.read(2)
        witness("first bytes", path, start.hex())
        if start == b"#!":
            return "code"  # a script that names its own interpreter, with or without a leading dot
    except OSError:
        witness("first bytes", path, "unreadable")
    return "other" if dotfile else f"no extension: {path.name}"


def normalize_scopes(root, scopes):
    """Scopes as posix paths relative to root, in their spelling on disk. [] means the whole root.
    Exits when a scope is not under root."""
    result = []
    base = Path(root).resolve() if root else None
    for raw in scopes:
        text = str(raw).replace("\\", "/")
        path = Path(str(raw))
        if path.is_absolute():
            if base is None:
                sys.exit(f"--scope is an absolute path and no source root was given: {raw}")
            try:
                text = path.resolve().relative_to(base).as_posix()
            except ValueError:
                sys.exit(f"--scope is not under the source root: {raw}")
        parts = [p for p in text.split("/") if p not in ("", ".")]
        if ".." in parts:
            sys.exit(f"--scope must not contain '..': {raw}")
        rel = "/".join(parts)
        if base is not None and rel:
            if not (base / rel).exists():
                sys.exit(f"--scope is not under the source root: {raw}")
            rel = (base / rel).resolve().relative_to(base).as_posix()
        result.append(rel)
    return [] if "" in result else result


def in_scope(rel, scopes):
    return not scopes or any(rel == s or rel.startswith(s + "/") for s in scopes)


def on_disk(root, rel):
    """rel (a path under root, any spelling) as its posix spelling on disk, or None when it is no file under root."""
    base = Path(root).resolve()
    try:
        path = (base / str(rel).replace("\\", "/")).resolve()
        found = path.relative_to(base).as_posix() if path.is_file() else None
    except (OSError, ValueError):
        found = None
    witness("on disk", root, rel, found)
    return found


def all_files(root):
    """Every file under root except what is inside .git, as posix paths."""
    root = Path(root)
    result = []
    for p in root.rglob("*"):
        if p.is_file():
            parts = p.relative_to(root).parts
            if ".git" not in parts[:-1]:
                result.append("/".join(parts))
    result.sort()
    witness("files under", root, *result)
    return result


def inventory(root, include_tests, scopes):
    """What is in scope, as a dict:
      code      the code files that need a File note
      unknown   {kind: count} of files that are neither known code nor known non-code
      other     {extension: count} of files known not to be code (documents, data, settings, media)
      left_out  {folder or 'test files': count of code files} that were skipped

    Folders named in SKIP_DIRS, and tests unless include_tests, are left out. A scope that names such a folder or
    file, or something inside it, is honoured: only what lies below the scope is judged."""
    code, unknown, other, left_out = [], {}, {}, {}
    root = Path(root)
    for rel in all_files(root):
        if not in_scope(rel, scopes):
            continue
        parts = rel.split("/")
        depth = max((len(s.split("/")) for s in scopes if rel == s or rel.startswith(s + "/")), default=0)
        below = parts[depth:-1]
        skipped = next((f for f in below if f.lower() in SKIP_DIRS or (not include_tests and f.lower() in TEST_DIRS)), None)
        kind = kind_of(root / rel)
        named = rel in scopes  # the file itself was asked for
        if skipped:
            if kind == "code":
                folder = "/".join(parts[:depth + below.index(skipped) + 1])
                left_out[folder] = left_out.get(folder, 0) + 1
            continue
        if kind == "code" and not include_tests and not named and is_test_file(parts[-1]):
            left_out["test files by name"] = left_out.get("test files by name", 0) + 1
            continue
        if kind == "code":
            code.append(rel)
        elif kind == "other":
            ext = Path(rel).suffix.lower() or Path(rel).name.lower()
            other[ext] = other.get(ext, 0) + 1
        else:
            unknown[kind] = unknown.get(kind, 0) + 1
    return {"code": code, "unknown": unknown, "other": other, "left_out": left_out}


def resolve_graph_paths(graph_paths, files):
    """{graph path: source path or None}. graphify writes paths relative to the folder it was run on, sometimes
    with leading folders in front. The number of leading folders to drop is chosen once, for all paths, as the one
    under which most graph paths name an existing file; after that a path must match a file exactly."""
    def key(p):
        return p.lower() if WINDOWS else p

    known = {key(f): f for f in files}
    paths = sorted({p.replace("\\", "/").strip("/") for p in graph_paths if p})
    if not paths:
        return {}
    most = min(len(p.split("/")) for p in paths) - 1
    best, best_hits = 0, -1
    for drop in range(0, most + 1):
        hits = sum(1 for p in paths if key("/".join(p.split("/")[drop:])) in known)
        if hits > best_hits:
            best, best_hits = drop, hits
    return {p: known.get(key("/".join(p.split("/")[best:]))) for p in paths}


def is_callable_node(node):
    """A function, method or class in the graph. PowerShell functions carry no marker but a label ending in ()."""
    return bool(node.get("_callable") or node.get("_callable_class") or str(node.get("label") or "").endswith("()"))


# ---------------------------------------------------------------- reading notes

BLOCK = re.compile(r"^### Block (\w+)\b.*\(lines? (\d+)(?:\s*-\s*(\d+))?\)\s*$")
LINE_CELL = re.compile(r"(\d+)(?:\s*-\s*(\d+))?")
FENCE = re.compile(r"^(`{3,})")
MASK = "[masked]"


def frontmatter(text):
    """The properties at the top of a note, as a dict of strings."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    props = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            props[key.strip()] = value.strip().strip("\"'")
    return props


def fence_mask(lines):
    """For each line: True when it is a fence line or inside a fence. A fence closes only on one at least as long."""
    mask, fence = [], None
    for line in lines:
        m = FENCE.match(line)
        if fence is None and m:
            fence = len(m.group(1))
            mask.append(True)
        elif fence is not None:
            mask.append(True)
            if m and len(m.group(1)) >= fence and line.strip("`").strip() == "":
                fence = None
        else:
            mask.append(False)
    return mask


def section(lines, mask, heading):
    """The lines under a '## <heading...>' line that is outside every fence, up to the next such '## ' line."""
    start = next((i for i, line in enumerate(lines) if not mask[i] and line.startswith("## " + heading)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if not mask[i] and lines[i].startswith("## ")), len(lines))
    return [lines[i] for i in range(start + 1, end) if not mask[i]]


def is_row(line):
    return line.lstrip().startswith("|")


def cells(row):
    """The cells of one table row, stripped. A | written as \\| stays inside its cell."""
    parts = re.split(r"(?<!\\)\|", row.strip())
    return [c.strip() for c in parts[1:-1]]


def mask_pattern(text, groups=False):
    """A regular expression for a line with [masked] in it: the text around each mask, anything in between."""
    joiner = "(.+?)" if groups else ".+?"
    return joiner.join(re.escape(part) for part in text.split(MASK))


def line_set(text, last):
    """'3, 7-9' -> {3, 7, 8, 9}, clipped to 1..last. Anything that is not a number or a range is ignored."""
    result = set()
    for piece in str(text).split(","):
        m = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", piece)
        if m:
            a, b = int(m.group(1)), int(m.group(2) or m.group(1))
            result.update(range(max(a, 1), min(b, last) + 1))
    return result


def note_blocks(note, mask):
    """The '### Block' sections of a File note, in the note's order. `note` is the note's lines, `mask` their
    fence_mask. Each block is a dict: id, a and b (the recorded lines), start (index of the heading), end (index
    after the block's last line), first (index of the opening line of its first code fence, or None), last (index
    of the first line after that fence) and code (the lines inside the fence, [] without one)."""
    starts = [i for i, line in enumerate(note) if not mask[i] and BLOCK.match(line)]
    blocks = []
    for n, start in enumerate(starts):
        m = BLOCK.match(note[start])
        end = starts[n + 1] if n + 1 < len(starts) else len(note)
        end = next((i for i in range(start + 1, end) if not mask[i] and note[i].startswith("## ")), end)
        first = next((i for i in range(start + 1, end) if mask[i]), None)
        last = end if first is None else next((i for i in range(first, end) if not mask[i]), end)
        blocks.append({"id": m.group(1), "a": int(m.group(2)), "b": int(m.group(3) or m.group(2)), "start": start,
                       "end": end, "first": first, "last": last,
                       "code": [] if first is None else note[first + 1:last - 1]})
    return blocks


def mask_fits(got, real):
    """Whether the source line `real` equals the copied line `got` around each [masked], each mask standing for at
    least one character. The same answer as re.fullmatch(mask_pattern(got), real), in one pass over the line."""
    parts = got.split(MASK)
    if not real.startswith(parts[0]):
        return False
    pos = len(parts[0])
    for piece in parts[1:-1]:
        at = real.find(piece, pos + 1)
        if at < 0:
            return False
        pos = at + len(piece)
    return len(real) - len(parts[-1]) >= pos + 1 and real.endswith(parts[-1])


def same_line(got, real, may_mask):
    """The check's comparison of one copied line with one source line. `may_mask`: the line's recorded number is
    listed in the note's masked_lines. A line that is [masked] alone matches any line."""
    if got == real:
        return True
    if MASK not in got or not may_mask:
        return False
    if got.strip() == MASK:
        return True
    return bool(got.replace(MASK, "").strip()) and mask_fits(got, real)


# ---------------------------------------------------------------- source hashes

SOURCE_HASH = re.compile(r"sha256:([0-9a-f]{64})")


def file_hash(path):
    """'sha256:<hex>' over the file's bytes as they are on disk, or None when it cannot be read. The value of the
    property source_hash of a File note."""
    try:
        digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError as error:
        witness("hash failed", path, type(error).__name__)
        return None
    witness("hash", path, digest)
    return "sha256:" + digest


def files_hash(root, files):
    """'sha256:<hex>' for several source files together: the property source_hash of a Mechanism or Flow note.
    It is the hash of one line per file, 'path<TAB>hash of the file', the paths as they are spelled on disk and
    sorted, so the order and the spelling in the note do not matter. A file that cannot be read counts as
    'missing'."""
    names = {on_disk(root, f.strip()) or f.strip().replace("\\", "/") for f in files if f.strip()}
    rows = [f"{rel}\t{file_hash(Path(root) / rel) or 'missing'}\n" for rel in sorted(names)]
    return "sha256:" + hashlib.sha256("".join(rows).encode("utf-8")).hexdigest()
