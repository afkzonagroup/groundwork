// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser entry point embedded in each module page. Grades the quiz on the
 * page and, in a SCORM package, reports the result to the LMS. Uses only
 * textContent, classList and the hidden property; no HTML strings.
 *
 * @packageDocumentation
 */

import { type AnswerKey, grade, parseAnswerKey } from './grade.js';
import { ScormSession, findScormApi } from './scorm.js';

function selected(form: HTMLFormElement, id: string): number | undefined {
  const inputs = form.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  for (const input of inputs) {
    if (input.name === `q-${id}` && input.checked) {
      const n = Number(input.value);
      return Number.isInteger(n) ? n : undefined;
    }
  }
  return undefined;
}

function optionLabel(doc: Document, id: string, index: number): string {
  const label = doc.querySelector(`label[for="q-${id}-${String(index)}"]`);
  return label?.textContent.trim() ?? '';
}

function setup(doc: Document, win: Window): void {
  const form = doc.getElementById('gw-quiz');
  const keyElement = doc.getElementById('gw-key');
  const result = doc.getElementById('gw-result');
  const retry = doc.getElementById('gw-retry');
  const submit = doc.getElementById('gw-check');
  if (!(form instanceof HTMLFormElement) || !keyElement || !result || !(retry instanceof HTMLButtonElement) || !(submit instanceof HTMLButtonElement)) return;
  const key: AnswerKey | undefined = parseAnswerKey(keyElement.textContent);
  if (!key) {
    result.textContent = 'This quiz cannot be checked because the page is damaged.';
    submit.disabled = true;
    return;
  }

  let session: ScormSession | undefined;
  const scormStatus = doc.getElementById('gw-scorm-status');
  if (doc.body.dataset.scorm === '1') {
    const api = findScormApi(win);
    if (api) {
      session = new ScormSession(api, Date.now());
      if (!session.start()) session = undefined;
    }
    if (scormStatus) scormStatus.textContent = session ? '' : 'Your learning platform could not be reached. Your result will not be recorded.';
    const finish = (): void => {
      session?.finish(Date.now());
    };
    win.addEventListener('pagehide', finish);
    win.addEventListener('beforeunload', finish);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const responses = new Map<string, number>();
    for (const a of key.answers) {
      const choice = selected(form, a.id);
      if (choice !== undefined) responses.set(a.id, choice);
    }
    const missing = key.answers.filter((a) => !responses.has(a.id));
    if (missing.length > 0) {
      result.textContent = `Please answer every question before checking. ${String(missing.length)} not answered yet.`;
      const first = missing[0];
      const firstInput = first ? doc.getElementById(`q-${first.id}-0`) : null;
      if (firstInput instanceof HTMLInputElement) firstInput.focus();
      return;
    }
    const outcome = grade(key, responses);
    for (const q of outcome.perQuestion) {
      const fieldset = doc.getElementById(`q-${q.id}`);
      const feedback = doc.getElementById(`fb-${q.id}`);
      const verdict = doc.getElementById(`verdict-${q.id}`);
      const answer = key.answers.find((a) => a.id === q.id);
      if (!fieldset || !feedback || !verdict || !answer) continue;
      fieldset.classList.remove('is-correct', 'is-wrong');
      fieldset.classList.add(q.correct ? 'is-correct' : 'is-wrong');
      verdict.textContent = q.correct ? 'Correct.' : `Not correct. The correct answer is: ${optionLabel(doc, q.id, answer.correct)}`;
      feedback.hidden = false;
    }
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) input.disabled = true;
    const verdictText = outcome.passed ? 'You passed this module.' : `You have not passed yet. You need ${String(key.passMark)} % to pass. Read the explanations and try again.`;
    result.textContent = `You answered ${String(outcome.correct)} of ${String(outcome.total)} questions correctly (${String(outcome.percent)} %). ${verdictText}`;
    if (session && scormStatus) {
      const sent = session.report(outcome.percent, outcome.passed);
      scormStatus.textContent =
        sent === 'sent'
          ? 'Your result has been sent to your learning platform.'
          : sent === 'kept'
            ? 'You passed this module before; your learning platform keeps that result.'
            : 'Your learning platform did not accept the result.';
    }
    submit.hidden = true;
    retry.hidden = false;
    result.focus();
  });

  retry.addEventListener('click', () => {
    form.reset();
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) input.disabled = false;
    for (const fieldset of form.querySelectorAll('fieldset')) fieldset.classList.remove('is-correct', 'is-wrong');
    for (const feedback of form.querySelectorAll<HTMLElement>('.feedback')) feedback.hidden = true;
    result.textContent = '';
    retry.hidden = true;
    submit.hidden = false;
    const first = form.querySelector('input[type="radio"]');
    if (first instanceof HTMLInputElement) first.focus();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setup(document, window);
  });
} else {
  setup(document, window);
}
