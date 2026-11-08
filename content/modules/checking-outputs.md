---
id: checking-outputs
title: Checking what AI produces
summary: Practical ways to check AI output before you use it, and why you stay responsible for what you do with it.
minutes: 12
---

## Learning objectives

- Check facts, sources, numbers and quotes in AI output against originals.
- Decide how much checking a task needs, based on who could be affected.
- Recognise when AI output should not be used at all.
- Explain what human oversight means for high-risk AI systems.

## You stay responsible

An AI tool does not take responsibility for its output. If you send, publish or decide on the basis of AI output, it is your work. Check it as you would check a draft from a new colleague who writes well but sometimes invents things.

## How to check

- **Facts and sources:** open the original source. Make sure it exists and says what the output claims.
- **Quotes:** find the exact words in the original.
- **Numbers:** recalculate them, or check them against your own records.
- **Summaries:** skim the original for anything important the summary left out.
- **Code:** read it, run the tests, and check for security problems before you use it.
- **Tone and fairness:** read it as the person it is about or for. Would it be fair to them?

## How much checking is enough

Match the effort to the harm a mistake could cause:

- A first draft of an internal note: a quick read.
- Anything sent to customers or published: check every fact.
- Anything that affects a person's job, money, health, rights or access to services: check thoroughly, and do not let the AI output decide on its own.

If you cannot check something, say so, or do not use it.

## Human oversight of high-risk AI

The AI Act has stricter rules for high-risk AI systems, such as some systems used in employment, education, credit or access to essential services (Annex III lists the areas). Providers must design these systems so that people can oversee them effectively (Article 14). Deployers must assign human oversight to people who have "the necessary competence, training and authority, as well as the necessary support" (Article 26(2)). For the high-risk systems listed in Annex III, these obligations apply from 2 December 2027 (Article 113, point (c), as amended by Regulation (EU) 2026/1744).

If you are asked to oversee such a system, you need to understand what it does and where it fails, and you need the authority to override or stop it.

::: role builders
### For people building or buying AI

- Test with data that looks like the real use, including the people at the edges.
- Measure error rates, and look at them separately for groups that could be treated unfairly.
- Write down known limitations and the checks users should do, in words users understand.
- Make it easy to see when output is uncertain, and easy to correct or override it.
:::

::: role managers
### For managers

Checking takes time. Plan for it. Make sure the people who oversee AI decisions have the training and the authority to say no, and that they are not penalised for slowing things down when something looks wrong.
:::

## Quiz

### Question checking-outputs-1
An AI tool summarises a 40-page contract for you. You will use the summary to advise a client. What should you do?

- [ ] Send the summary as it is.
- [x] Check the key points against the contract itself, and look for important terms the summary left out.
- [ ] Ask the tool to shorten the summary further.

Explanation: Summaries can leave out the one clause that matters. Advice to a client needs a check against the original.

### Question checking-outputs-2
Who is responsible for an email you send that was drafted by an AI tool?

- [ ] The AI tool's provider.
- [x] You (and your organisation), as with any email you send.
- [ ] Nobody, because AI wrote it.

Explanation: Using AI to draft does not move responsibility for what you send.

### Question checking-outputs-3
Which task needs the most careful checking of AI output?

- [ ] Brainstorming names for an internal team event.
- [ ] Rewording your own notes for yourself.
- [x] Preparing a recommendation about whether to reject a person's loan application.

Explanation: Decisions about people's money, jobs, health or rights can cause serious harm. They need thorough checks, and AI output should not decide alone.

### Question checking-outputs-4
An AI tool gives you a statistic for a press release, but you cannot find any source for it. What should you do?

- [ ] Publish it, since it sounds plausible.
- [ ] Round it to make it look less precise.
- [x] Leave it out unless you can confirm it from a reliable source.

Explanation: If you cannot check a fact, do not publish it.

### Question checking-outputs-5
Under the AI Act, who must deployers of high-risk AI systems assign human oversight to?

- [ ] Anyone who is available.
- [x] People with the necessary competence, training and authority, and the necessary support.
- [ ] Only external auditors.

Explanation: Article 26(2) of the AI Act.

### Question checking-outputs-6
Roles: builders

What should you give the users of an AI system you built?

- [ ] Nothing; good systems need no explanation.
- [x] Clear information about known limitations and the checks users should do.
- [ ] Only the source code.

Explanation: Users can only check output well if they know where the system tends to fail.

### Question checking-outputs-7
Roles: managers

A team member stops an AI-supported decision because the result looks wrong, and the team misses a deadline. What is the right response?

- [x] Support the decision to stop and look into the problem.
- [ ] Tell them to trust the AI next time.
- [ ] Remove their authority to override the system.

Explanation: Human oversight only works if people may use it. People who oversee AI need authority and support (Article 26(2) for high-risk systems).

## Sources

- [AI Act, Article 14: human oversight](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_14)
- [AI Act, Article 26: obligations of deployers of high-risk AI systems](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_26)
- [AI Act, Annex III: high-risk areas](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#anx_III)
- [AI Act, Article 113: application dates (consolidated text)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_113)
