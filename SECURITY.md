# Security

BackSoon runs commands you start, stores their records and output in the project's `.backsoon` folder, and serves the panel on `127.0.0.1` only. A report is a security issue if it lets another local user, a web page or a task's output read task records, run commands, or inject instructions into a Codex chat.

## Report a vulnerability

Report it privately through [GitHub security advisories](https://github.com/chentyke/backsoon/security/advisories/new). Do not open a public issue. Include the BackSoon version (`backsoon --version`), your OS, the output of `node --version`, and the smallest steps that reproduce it. Replace private paths, chat IDs and tokens.

You should get a reply within a week. Fixes go into the latest release; older versions are not patched.
