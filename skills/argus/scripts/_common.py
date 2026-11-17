"""Shared by the scripts: reading files and notes, which files count as source, scopes, graph paths, hashes."""
import hashlib
import json
from bisect import bisect_left
import os
import re
import sys
from pathlib import Path, PureWindowsPath

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
    """Whether the path lies in one of the scopes ([] is everything). On Windows letter case does not tell two
    paths apart, so it does not here either: the scope gone.py holds the source Gone.py of a file that is no
    longer there to give its spelling."""
    if WINDOWS:
        rel, scopes = rel.lower(), [s.lower() for s in scopes]
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


# What no file or folder name on Windows can be: one that holds < > : " | ? * or a control character, one that
# ends in a dot or a space, or the name of a device (CON, NUL, COM1 ..., with or without an extension).
NO_FILE_NAME = re.compile(r'[<>:"|?*\x00-\x1f]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]) *(?:\.|$)', re.IGNORECASE)


def plain_relative(rel):
    """rel as a plain path under the source root, with / and without '.' parts, or None when its form alone says
    it is no such path: empty, with a drive ('C:/x', also 'Z:x' without a slash), a network start ('//server'),
    a leading / or \\, a '..' part, or a part that no Windows file name can be ('a?.py', 'a|b.py', a name that
    ends in a dot or a space, 'NUL', 'com1.txt'). The last holds on every system: a set of notes moves between
    systems, so such a 'source' is a mistake in the property wherever it is read. It does not look at the disk:
    on_disk() says whether a file is there. A path that this function refuses can never be 'a file that was
    deleted'; it is a mistake in a property."""
    text = str(rel).strip().replace("\\", "/")
    if not text or text.startswith("/") or PureWindowsPath(text).drive or ":" in text.split("/")[0]:
        return None
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if not parts or ".." in parts or any(NO_FILE_NAME.search(part) for part in parts):
        return None
    return "/".join(parts)


def missing_under_root(root, plain):
    """Whether a file that is not there would lie under the source root: the nearest folder of its path that does
    exist must itself be a place under the root, by the rule on_disk() uses (links followed). `plain` is a path
    from plain_relative(). False for 'link/missing.py' when the folder 'link' leads out of the root."""
    base = Path(root).resolve()
    path = base / plain
    try:
        while not os.path.lexists(path):
            path = path.parent
        path.resolve().relative_to(base)
        return path.resolve().is_dir()
    except (OSError, ValueError):
        return False


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


BACKTICKS = re.compile(r"`+")
TICK_OR_ESCAPE = re.compile(r"[`\\]")


def without_inline_code(line):
    """The line with every `code span` removed, so that [[ or %% inside code is not read as a link or a comment.
    Code spans are read as Markdown reads them: a run of backticks opens a span that the next run of the same
    length closes; a backtick with a backslash in front of it (outside a span) is a plain character and opens
    nothing; a run that is never closed is plain text.

    The work grows with the length of the line only: the runs of backticks are listed once, by their length, and
    the run that closes a span is looked up in that list, never searched for in the rest of the line."""
    if "`" not in line:
        return line
    by_length = {}                                   # length of a run -> where the runs of that length start
    for m in BACKTICKS.finditer(line):
        by_length.setdefault(m.end() - m.start(), []).append(m.start())
    out, i, n = [], 0, len(line)
    while i < n:
        m = TICK_OR_ESCAPE.search(line, i)
        if m is None:
            out.append(line[i:])
            break
        at = m.start()
        out.append(line[i:at])
        if line[at] == "\\":
            out.append(line[at:at + 2])              # an escaped character, a backtick too: kept as text
            i = at + 2
            continue
        end = BACKTICKS.match(line, at).end()        # the run that may open a span: line[at:end]
        starts = by_length.get(end - at, ())
        k = bisect_left(starts, end)                 # the next run of the same length after it
        if k < len(starts):
            out.append(" ")
            i = starts[k] + (end - at)
        else:
            out.append(line[at:end])                 # never closed: the backticks are text
            i = end
    return "".join(out)


LINK = re.compile(r"\[\[([^\]|#]+)")


def link_names(text):
    """The notes that the [[links]] of a piece of note text name, in order: the text outside code spans, each link
    without its alias, its heading, its folders and an optional .md. The one place that knows this; the check and
    changed_blocks.py both use it. Give it text that holds no code fence."""
    names = []
    for target in LINK.findall(without_inline_code(text)):
        target = target.rstrip("\\").strip().split("/")[-1]
        names.append(target[:-3] if target.lower().endswith(".md") else target)
    return names


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
    """(hash, rejected): the property source_hash of a Mechanism or Flow note, for the source files it lists.

    One file: the file's own hash, the same value a File note of that file has. Several files: the hash of one
    line per file, 'path<TAB>hash of the file', the paths as they are spelled on disk and sorted, so the order and
    the spelling in the note do not matter.

    `rejected` are the names that are no file under the source root (missing, an absolute path, a path or a link
    that leads out of the root). Such a file is never opened. It counts as 'missing' in the hash of several
    files; when it is the only file the hash is None."""
    present, rejected = source_set(root, files)
    if len(present) + len(rejected) == 1:
        return (None if rejected else file_hash(Path(root) / present[0])), rejected
    rows = sorted([f"{name}\t{file_hash(Path(root) / name) or 'missing'}\n" for name in present]
                  + [f"{name}\tmissing\n" for name in rejected])
    return "sha256:" + hashlib.sha256("".join(rows).encode("utf-8")).hexdigest(), rejected


def source_set(root, files):
    """(present, rejected) for a list of source names as a note or a command line gives them. `present` are the
    files under the source root, each once, in their spelling on disk, sorted: 'a/b.py' and './a/b.py' are one
    file. `rejected` are the names that are no file under the root, each once (two spellings of one plain path
    count once). Everything that hashes or counts the sources of a note goes through here, so no two places can
    take the same list for a different number of files."""
    present, rejected = set(), set()
    for name in (str(f).strip().replace("\\", "/") for f in files):
        if not name:
            continue
        found = on_disk(root, name)
        if found:
            present.add(found)
        else:
            rejected.add(plain_relative(name) or name)
    return sorted(present), sorted(rejected)


# ---------------------------------------------------------------- line ranges and block ids

def line_ranges(text):
    """'3, 7-9, 8-12' -> [[3, 3], [7, 12]]: the ranges in rising order, those that meet joined. Never a list of
    single lines, so a range of any size costs nothing. Anything that is not a number or a range is ignored."""
    found = []
    for piece in str(text).split(","):
        m = re.fullmatch(r"\s*(\d{1,12})(?:\s*-\s*(\d{1,12}))?\s*", piece)
        if m:
            a, b = max(int(m.group(1)), 1), int(m.group(2) or m.group(1))
            if a <= b:
                found.append([a, b])
    return merge_ranges(found)


def merge_ranges(ranges):
    result = []
    for a, b in sorted(ranges):
        if result and a <= result[-1][1] + 1:
            result[-1][1] = max(result[-1][1], b)
        else:
            result.append([a, b])
    return result


def in_ranges(ranges, n):
    """Whether line n is in one of the merged ranges."""
    low, high = 0, len(ranges)
    while low < high:
        mid = (low + high) // 2
        if ranges[mid][1] < n:
            low = mid + 1
        else:
            high = mid
    return low < len(ranges) and ranges[low][0] <= n


def cut_ranges(ranges, a, b):
    """(the parts of the ranges inside a..b, the parts outside)."""
    inside, outside = [], []
    for c, d in ranges:
        if d < a or c > b:
            outside.append([c, d])
            continue
        inside.append([max(c, a), min(d, b)])
        if c < a:
            outside.append([c, a - 1])
        if d > b:
            outside.append([b + 1, d])
    return inside, outside


def retired_ids(props):
    """The block ids a File note lists in its property retired_blocks: ids of removed blocks, never used again."""
    return [piece.strip() for piece in props.get("retired_blocks", "").split(",") if piece.strip()]
