// on_github.js: is this run on GitHub's Actions runner? GitHub sets GITHUB_ACTIONS=true in every job (.github/workflows/ci.yml).
//
//   onGitHub(reason) -> false here, or "skipped on GitHub's runner only: <reason>" there; a row passes it as (or with) its own skip
//
// A row that needs what that runner does not have (a GPU, the speed to mount the page within the row's own wait, a Windows PowerShell
// that can load its own modules) skips THERE ONLY, saying why and naming the run that showed it; on any other machine it runs exactly
// as before. Not a pattern: each row that uses it is named in CHANGELOG.md and says its reason.
'use strict';
const ON_GITHUB = process.env.GITHUB_ACTIONS === 'true';
const onGitHub = (reason) => (ON_GITHUB ? `skipped on GitHub's runner only: ${reason}` : false);
module.exports = { ON_GITHUB, onGitHub };
