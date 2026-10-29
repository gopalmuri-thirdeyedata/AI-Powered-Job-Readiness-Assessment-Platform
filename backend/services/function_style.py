"""
LeetCode structure for stdin/stdout coding problems (student assessment round and Practice).

The assessment problems are graded by feeding text to stdin and comparing stdout. Their starter code carries the plumbing:
a function to fill in, followed by an `if __name__ == '__main__':` block that reads stdin, calls the function and prints.
LeetCode shows none of that: the student sees ONLY the class and the method signature and writes the logic. This module splits a starter into:

  * what the student sees:  `class Solution:` with the method signature and an empty body (no imports, no helper code, no scaffolding)
  * the driver the server keeps:  the original imports + the original main block, calling `Solution().<function>(...)`

and `compose()` builds the program for the sandbox: a hidden line of the usual imports (typing, collections, heapq, bisect, math ...; LeetCode
pre-imports them too), the student's code, then the driver. The prelude is exactly one line per import group, and `fix_line_numbers()` removes
it from any traceback so the line numbers the student reads are the ones in their editor. Starters that do not have the expected shape are
left exactly as they are.
"""
import ast
import re
from typing import Dict, List, Optional

_MAIN = re.compile(r"^if\s+__name__\s*==\s*['\"]__main__['\"]\s*:", re.M)
_DEF = re.compile(r"^def\s+([A-Za-z_]\w*)\s*\(", re.M)
_IMPORT = re.compile(r"^(?:import|from)\s+\S")
_SIMPLE_IMPORT = re.compile(r"^(?:import\s+[\w., ]+|from\s+[\w.]+\s+import\s+[\w*., ]+)$")

# What LeetCode makes available without an import. One line, so it is one hidden line above the student's code.
STANDARD_IMPORTS = (
    "from typing import *; from collections import deque, defaultdict, Counter, OrderedDict; "
    "import collections, math, heapq, bisect, itertools, functools, re, string, sys; "
    "from heapq import heappush, heappop, heapify, heappushpop, nlargest, nsmallest; "
    "from bisect import bisect_left, bisect_right, insort; from functools import lru_cache, reduce; from math import inf"
)


def _matching_paren(text: str, open_index: int) -> int:
    depth = 0
    for i in range(open_index, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _function_variant(starter: Optional[str]) -> Optional[Dict[str, str]]:
    """
    Returns {"starter": <what the student edits>, "driver": <server-side main block>, "function": <name>} or None when the starter
    is not a function plus a main block that calls it (the caller then keeps the original starter unchanged).
    """
    if not isinstance(starter, str) or not starter.strip():
        return None
    main = _MAIN.search(starter)
    if not main:
        return None
    head, main_block = starter[:main.start()], starter[main.start():]
    definition = _DEF.search(head)
    if not definition:
        return None
    name = definition.group(1)
    if not re.search(rf"(?<![\w.]){re.escape(name)}\(", main_block):
        return None                                             # the driver does not call the function: nothing to hide

    open_paren = definition.end() - 1
    close_paren = _matching_paren(head, open_paren)
    if close_paren < 0:
        return None
    params = head[open_paren + 1:close_paren].strip()

    function_block = head[definition.start():]
    for line in function_block.splitlines()[1:]:               # after the def line: only the body (indented) or blank lines
        if line.strip() and not line.startswith((" ", "\t")):
            return None
    after_params = head[close_paren + 1:].split("\n", 1)[0].rstrip()          # " -> bool:" (or just ":")
    if not after_params.endswith(":"):
        return None
    signature = f"    def {name}(self{', ' + params if params else ''}){after_params}"
    student = f"class Solution:\n{signature}\n        \n"        # signature only: the student writes the logic, nothing else is shown

    before = head[:definition.start()]
    imports = "\n".join(ln for ln in before.splitlines() if _IMPORT.match(ln.strip()))
    call = re.compile(rf"(?<![\w.]){re.escape(name)}\(")
    driver = (imports + "\n\n" if imports else "") + call.sub(f"Solution().{name}(", main_block)
    if not driver.endswith("\n"):
        driver += "\n"
    return {"starter": student, "driver": driver, "function": name}


def _class_variant(starter: Optional[str]) -> Optional[Dict[str, str]]:
    """
    Design problems (LRUCache, MedianFinder ...): the starter is a class and a main block that drives it. The student sees the class with its
    method signatures and empty bodies (no solution, no helper code); the server keeps the imports, any other top-level code and the main block.
    """
    if not isinstance(starter, str) or not starter.strip():
        return None
    try:
        tree = ast.parse(starter)
    except SyntaxError:
        return None
    lines = starter.splitlines()
    main = next((n for n in tree.body if isinstance(n, ast.If) and "__name__" in ast.unparse(n.test) and "__main__" in ast.unparse(n.test)), None)
    if main is None:
        return None
    main_text = "\n".join(lines[main.lineno - 1:main.end_lineno])
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]
    targets = [c for c in classes if re.search(rf"(?<![\w.]){re.escape(c.name)}\(", main_text)]
    if not targets:
        return None
    stubs = []
    for cls in targets:
        bases = f"({', '.join(ast.unparse(b) for b in cls.bases)})" if cls.bases else ""
        methods = []
        for node in cls.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name.startswith("_") and node.name != "__init__":
                continue                                          # private helpers are part of the solution, not the interface
            returns = f" -> {ast.unparse(node.returns)}" if node.returns is not None else ""
            methods.append(f"    def {node.name}({ast.unparse(node.args)}){returns}:\n        \n")
        if not methods:
            return None
        stubs.append(f"class {cls.name}{bases}:\n" + "\n".join(methods))
    imports = [ast.get_source_segment(starter, n) for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    others = ["\n".join(lines[n.lineno - 1:n.end_lineno]) for n in tree.body
              if not isinstance(n, (ast.Import, ast.ImportFrom)) and n not in targets]
    driver = "\n".join(i for i in imports if i) + "\n\n" + "\n\n".join(others)
    if not driver.endswith("\n"):
        driver += "\n"
    return {"starter": "\n".join(stubs), "driver": driver, "function": targets[0].name}


def to_function_style(starter: Optional[str]) -> Optional[Dict[str, str]]:
    """The student-facing starter and the hidden driver, for a function problem or a class-design problem (None: keep the starter as it is)."""
    return _function_variant(starter) or _class_variant(starter)


def _leading_imports(driver: str) -> List[str]:
    """The imports at the top of a driver (the original starter's own imports): the student's code needs them before it is defined."""
    found: List[str] = []
    for line in driver.split("\n\n", 1)[0].splitlines():
        if _IMPORT.match(line.strip()):
            found.append(line.strip())
    return found


def prelude_for(driver: Optional[str]) -> str:
    """The hidden lines placed before the student's code: the standard imports, plus the problem's own imports."""
    extra = [ln for ln in _leading_imports(driver or "") if _SIMPLE_IMPORT.match(ln)]
    return "; ".join([STANDARD_IMPORTS] + extra)


def prelude_line_count(driver: Optional[str]) -> int:
    return 1 if driver else 0                                  # always a single hidden line


def compose(student_code: str, driver: Optional[str]) -> str:
    """The program the sandbox runs: hidden imports, the student's code, then the server's driver."""
    if not driver:
        return student_code
    return f"{prelude_for(driver)}\n{student_code.rstrip()}\n\n\n{driver}"


def compose_solutions(keys: Optional[Dict], solutions: Optional[Dict]) -> Dict:
    """
    Adds each problem's server-side driver around the student's code before it is graded. Only the copy sent to the sandbox is composed: the
    stored submission stays exactly what the student wrote. Problems without a driver (older sessions) run as written.
    """
    composed: Dict = {}
    for pid, sol in (solutions or {}).items():
        driver = ((keys or {}).get(str(pid)) or {}).get("driver")
        if driver and isinstance(sol, dict) and (sol.get("language") or "python") in ("python", "python3"):
            sol = {**sol, "code": compose(sol.get("code") or "", driver)}
        composed[pid] = sol
    return composed


_LINE = re.compile(r"(\bline )(\d+)")


def fix_line_numbers(text, shift: int):
    """Tracebacks count the hidden prelude line: subtract it so the numbers match the student's editor."""
    if not text or not shift:
        return text
    return _LINE.sub(lambda m: f"{m.group(1)}{int(m.group(2)) - shift}" if int(m.group(2)) > shift else m.group(0), str(text))
