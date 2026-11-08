# Contributing

Thank you for helping. Groundwork teaches people about the law and keeps
records about people, so accuracy and security come first.

## Before you start

- Open an issue to discuss larger changes.
- Pull requests require the [Contributor Licence Agreement](CLA.md). Add the
  signature line from CLA.md to your first pull request. Content you
  contribute to `content/` is also published under CC BY 4.0.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never put real personal data in issues, tests or fixtures.

## Development

```sh
npm ci
npm run check          # typecheck + lint + tests with coverage
npm run build          # library and CLI in dist/
npm run build:client   # after changing src/client/: regenerates the page script
node dist/cli/main.js lint
```

## Course content

- Write plainly, in short sentences, for people without a technical or legal
  background.
- Every statement about the law must cite the official text on EUR-Lex,
  using links of the form
  `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:<number>#art_<n>`.
  Add new acts to `src/legal/sources.ts`. Do not rely on blogs or summaries
  for what the law says.
- Quote the law exactly. Say what it requires and what it does not. Never
  write that the course or the tool makes anyone compliant, or that a
  certificate is required.
- Each module needs 3 to 8 learning objectives, at least 4 quiz questions for
  every role, exactly one correct option per question, an explanation for
  each question, and a Sources section. `groundwork lint` checks this.
- **Translations are welcome.** Put them in a separate content directory
  with its own `course.json` and `language`. Take quotations of the law from
  the official language version on EUR-Lex. A native speaker who knows the
  subject must review the translation before it is merged; say in the pull
  request who reviewed it.

## Code

- TypeScript strict mode, no `any`, no `@ts-ignore`; `eslint-disable` only
  with a written reason.
- No runtime dependencies.
- Every security control needs a test that fails when the control is
  removed.
- Never write invisible or bidirectional Unicode characters into files; use
  `\u` escapes in code. A test checks every file.
- Keep the attribution "Groundwork by AFKzona Group" in interfaces and
  generated pages (LICENSE-ADDITIONAL-TERMS.md).
- Update CHANGELOG.md.
