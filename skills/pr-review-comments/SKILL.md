---
name: pr-review-comments
description: "Review, triage, and resolve PR review comments. Use when user asks to check PR comments, address review feedback, fix issues raised in review, reply to reviewers, or resolve review threads."
disable-model-invocation: true
---

# PR Review Comments

Triage and address review comments on a pull request: read each comment, decide if valid, fix code, verify tests pass, reply, and resolve threads.

## Prerequisites

- `gh` CLI authenticated
- Working directory inside the repo (or use `--repo owner/repo`)

## Workflow

### 1. Fetch review comments

Get all review comments with context:

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {id, path, line, body, user: .user.login}'
```

Also check top-level PR comments (non-inline):

```bash
gh api repos/{owner}/{repo}/issues/{pr}/comments \
  --jq '.[] | {id, body, user: .user.login}'
```

### 2. Triage each comment

For each comment, decide:

- **Valid & actionable** → fix the code
- **Valid but won't fix** → reply with rationale
- **Invalid / misunderstanding** → reply with explanation
- **Question** → answer it

Read the relevant file context before deciding. Don't blindly accept or reject.

### 3. Fix code

Apply fixes for valid comments. Group related fixes into a single commit. Use conventional commit style:

```
fix(<scope>): address PR review comments

- <summary of fix 1>
- <summary of fix 2>
```

Stage, commit, and push.

### 4. Validate tests pass

After fixing code, **always run tests before pushing** to make sure the fixes don't break anything:

- Run the project's test command (check project docs / `CLAUDE.md` / `Makefile` / `mise` tasks for the right command).
- If tests fail, fix the issue before pushing. A review fix that breaks CI is worse than the original comment.
- If the fix changes test expectations (e.g., updated output values), update the tests too.
- Pay special attention to mock/stub setups — removing or changing mocks can cause unrelated tests to fail when test infrastructure intercepts more than expected (e.g., `mock_provider` intercepting locally-evaluated data sources).

Only push once all tests are green.

### 5. Reply to comments

Reply to each review comment thread using the `in_reply_to` field:

```bash
gh api -X POST repos/{owner}/{repo}/pulls/{pr}/comments \
  -f body="<reply text>" \
  -F in_reply_to=<original_comment_id>
```

**Important:** The `in_reply_to` parameter must be a number (`-F`), not a string (`-f`). Use `-F` for numeric values.

Keep replies concise: state what was done or why not.

### 6. Resolve threads

Fetch unresolved thread node IDs via GraphQL:

```bash
gh api graphql -f query='
{
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {pr}) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { databaseId body }
          }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | {id, commentId: .comments.nodes[0].databaseId, body: (.comments.nodes[0].body[:80])}'
```

Resolve each thread after replying:

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {threadId: "<thread_node_id>"}) {
    thread { isResolved }
  }
}'
```

Loop over all thread IDs to resolve in batch:

```bash
for tid in PRRT_abc PRRT_def PRRT_ghi; do
  gh api graphql -f query="mutation { resolveReviewThread(input: {threadId: \"$tid\"}) { thread { isResolved } } }"
done
```

## Rules

- **Read before deciding.** Always read the file/context around the commented line before accepting or rejecting.
- **Don't blindly accept.** Evaluate each comment on merit. Some automated/AI review comments are wrong.
- **Don't blindly reject.** If a comment points out a real issue, fix it even if the wording is off.
- **Test before pushing.** Run the full test suite (or at minimum the affected module's tests) after every fix. Never push code you haven't validated.
- **Codify repeatable findings.** If a fixed comment is mechanically enforceable or clearly recurring, add a guard in the same commit via the `review-guards` skill (ast-grep rule with test; qualitative → a line in `REVIEW_GUIDELINES.md`).
- **One commit for all fixes.** Don't create separate commits per comment unless changes are unrelated.
- **Reply to every comment.** Even if resolved by a code change, confirm what was done.
- **Resolve only after replying.** Don't resolve threads without a reply — reviewers need to see acknowledgment.
- **Push before replying.** The fix commit should be visible in the PR when the reviewer reads the reply.
