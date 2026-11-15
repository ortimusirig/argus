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
    "", ".md", ".txt", ".rst", ".adoc", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
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
        if base is not None and rel and not (base / rel).exists():
            sys.exit(f"--scope is not under the source root: {raw}")
        result.append(rel)
    return [] if "" in result else result


def in_scope(rel, scopes):
    return not scopes or any(rel == s or rel.startswith(s + "/") for s in scopes)


def same_path(a, b):
    """True when two posix paths name the same file, one of them possibly with more leading folders."""
    a, b = a.strip("/"), b.strip("/")
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def inventory(root, include_tests, scopes):
    """(code files in scope, {extension: count} of files in scope that are neither code nor known non-code)."""
    code, unknown = [], {}
    root = Path(root)
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        folders = set(rel.parts[:-1])
        if folders & SKIP_DIRS or (not include_tests and folders & TEST_DIRS):
            continue
        rel = rel.as_posix()
        if not in_scope(rel, scopes):
            continue
        ext = p.suffix.lower() if not p.name.startswith(".") or p.suffix else p.name.lower()
        if ext in CODE_EXT:
            code.append(rel)
        elif ext not in NOT_CODE_EXT:
            unknown[ext] = unknown.get(ext, 0) + 1
    return code, unknown
