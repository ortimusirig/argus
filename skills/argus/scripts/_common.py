"""Shared by check_notes.py and graph_plan.py: which files count as source, and how a scope is read."""
import sys
from pathlib import Path

# Files that hold code a reader must have explained.
CODE_EXT = {
    ".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro",
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
    ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".plist", ".snap", ".patch", ".diff", ".template",
}
SKIP_DIRS = {
    "node_modules", ".git", "venv", ".venv", "__pycache__", "dist", "build", "out", "download", "graphify-out",
    ".pytest_cache", "coverage", "vendor", ".claude", ".idea", ".vscode", "target", ".next", ".nuxt",
}
TEST_DIRS = {"test", "tests", "__tests__", "spec"}
# Files without an extension that hold code, by name (lower case).
CODE_NAMES = {"makefile", "gnumakefile", "dockerfile", "containerfile", "rakefile", "gemfile", "jenkinsfile",
              "vagrantfile", "justfile", "procfile", "brewfile", "cmakelists.txt"}
# Files without an extension that are documents, by name (lower case).
DOC_NAMES = {"license", "licence", "readme", "notice", "authors", "changelog", "contributors", "copying",
             "codeowners", "version", "patents"}


def kind_of(path):
    """'code', 'other' (documents, data, settings, media) or a label for a kind this check does not know."""
    name = path.name.lower()
    if name in CODE_NAMES:
        return "code"
    if name.startswith(".") and name.count(".") == 1:
        return "other"  # a settings file such as .gitignore
    ext = path.suffix.lower()
    if ext in CODE_EXT:
        return "code"
    if ext in NOT_CODE_EXT:
        return "other"
    if ext:
        return ext
    if name in DOC_NAMES:
        return "other"
    try:
        with open(path, "rb") as handle:
            if handle.read(2) == b"#!":
                return "code"  # a script that names its own interpreter
    except OSError:
        pass
    return f"no extension: {path.name}"


def normalize_scopes(root, scopes):
    """Scopes as posix paths relative to root. '' means the whole root. Exits when a scope is not under root."""
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
            # The spelling on disk: on Windows and macOS a scope may be typed in another letter case.
            rel = (base / rel).resolve().relative_to(base).as_posix()
        result.append(rel)
    return [] if "" in result else result


def in_scope(rel, scopes):
    return not scopes or any(rel == s or rel.startswith(s + "/") for s in scopes)


def match_source(path, candidates):
    """The candidate that names the same file as path: an exact match, or else the only candidate that differs
    from it by leading folders alone. None when nothing matches or more than one does."""
    path = path.strip("/")
    if path in candidates:
        return path
    loose = [c for c in candidates if c.endswith("/" + path) or path.endswith("/" + c)]
    return loose[0] if len(loose) == 1 else None


def inventory(root, include_tests, scopes):
    """(code files in scope, {kind: count} of files of unknown kind, {folder: count} of code files left out).

    Folders named in SKIP_DIRS (dependencies, build output, tool folders), and test folders unless include_tests,
    are left out. A scope that names such a folder, or something inside it, is honoured: only folders below the
    scope are judged. The third value tells how many code files each left-out folder held, so nothing is dropped
    without a word."""
    code, unknown, left_out = [], {}, {}
    root = Path(root)
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        parts = p.relative_to(root).parts
        if ".git" in parts[:-1]:
            continue
        rel = "/".join(parts)
        if not in_scope(rel, scopes):
            continue
        depth = max((len(s.split("/")) for s in scopes if rel == s or rel.startswith(s + "/")), default=0)
        below = parts[depth:-1]
        skipped = next((f for f in below if f in SKIP_DIRS or (not include_tests and f in TEST_DIRS)), None)
        if skipped:
            if kind_of(p) == "code":
                folder = "/".join(parts[:depth + below.index(skipped) + 1])
                left_out[folder] = left_out.get(folder, 0) + 1
            continue
        kind = kind_of(p)
        if kind == "code":
            code.append(rel)
        elif kind != "other":
            unknown[kind] = unknown.get(kind, 0) + 1
    return code, unknown, left_out
