/** Deliberately break githubTool after webSearchTool succeeds. */
let githubBroken = false;
let searchCompleted = false;

export function resetDemoState() {
  githubBroken = false;
  searchCompleted = false;
}

export function armGithubFailure() {
  githubBroken = true;
}

export function disarmGithubFailure() {
  githubBroken = false;
}

export function isGithubBroken() {
  return githubBroken;
}

export function markSearchCompleted() {
  searchCompleted = true;
}

export function hasSearchCompleted() {
  return searchCompleted;
}
