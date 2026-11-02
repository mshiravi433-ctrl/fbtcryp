# kronos_model — vendored from shiyu-coder/Kronos

Files in this folder are copied from the upstream repository so the worker
builds without a GitHub dependency and the model code is reviewable in-tree.

- Upstream: https://github.com/shiyu-coder/Kronos
- Commit: `67b630e67f6a18c9e9be918d9b4337c960db1e9a` (master, 2026-04-13)
- License: MIT (upstream `LICENSE` — same terms as this repository)
- Files: `kronos.py`, `module.py`, `__init__.py` (model, module, package exports)

## Patches applied (import hygiene only — no math, no architecture)

1. `kronos.py`: `sys.path.append("../")` + `from model.module import *`
   replaced with `from .module import *`. The upstream import only works when
   the process CWD sits next to their `model/` folder; the worker imports this
   package from anywhere.
2. `kronos.py`: `from tqdm import trange` wrapped in try/except with a plain
   `range` fallback. `trange` is only used when `verbose=True`, which the
   worker never passes; this drops a dependency the worker does not need.

Update procedure: copy the three files again from a newer upstream commit,
re-apply the two patches above, run `python3 -m unittest forecast.test_worker`
and `npm run test:forecast`.
