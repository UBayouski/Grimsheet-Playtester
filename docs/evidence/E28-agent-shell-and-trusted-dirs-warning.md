# E28: agent shell facts and a gateway warning, for Notes task 8 (from run A4)

date: 2026-11-07. Crew 0.12.0. Paths use ~. Source: session `dashboard_chat-5-1794073967`, gateway log `~\.kiro\crew\gateway.log`.

- **The agent's shell is Windows PowerShell 5.1.** Observed from git's output: `git clone` writes its normal progress text (`Cloning into ...`) to stderr, and the shell reports it as `git : Cloning into '...'` with `CategoryInfo : NotSpecified: (...) [], RemoteException` and `FullyQualifiedErrorId : NativeCommandError`, while the exit code is 0 (`$LASTEXITCODE`). A check that treats that text as a failure would be wrong; read the exit code. The tool the model calls is named `run_command` (the name for `execute_bash` on this backend).
- **Gateway warning, exact text** (module `kiro_crew.platform_compat`, one line each for `node`, `npm` and `git` at 09:53:25, 09:53:27 and 09:53:28 local, while the agent ran those commands; the commands still ran):

```
WARNING kiro_crew.platform_compat [PID <gateway pid>]: node is on PATH at C:\Program Files\nodejs\node.EXE but does not resolve under the trusted system directories (C:\WINDOWS\system32, C:\WINDOWS\system32\WindowsPowerShell\v1.0), so it is treated as unavailable; OS introspection that needs it degrades instead of running a PATH-chosen binary
```

  The `npm` line says `npm is on PATH at C:\Program Files\nodejs\npm.CMD ...` and the `git` line says `git is on PATH at C:\Program Files\Git\cmd\git.EXE ...`; the rest is identical. Reading: Crew's own OS introspection will not use a PATH-chosen binary outside those two folders. It did not stop the agent's shell from running `node`, `npm` or `git`. Which Crew feature the introspection serves is not shown.