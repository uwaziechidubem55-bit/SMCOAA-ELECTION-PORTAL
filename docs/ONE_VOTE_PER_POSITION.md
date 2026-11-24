# One ballot choice per position

The voter interface groups candidate cards under normalized position names, so one candidate can be chosen for each position. Server-side enforcement remains authoritative: it rejects duplicate candidate IDs, missing candidates and multiple selected candidates for the same normalized position before writing anything.

## Behavior

- Candidate position names are normalized across capitalization, spacing, punctuation and common abbreviations.
- Different offices remain distinct (for example, Vice President 1 and Vice President 2).
- The entire ballot is submitted once. A Firestore transaction increments each selected candidate's tally and marks `members/{set-sn}` as voted, preventing concurrent duplicate submissions.
- A rejected ballot does not alter candidate totals or mark the member as voted.

## Files

- `src/utils/positions.js` — client normalization and ballot grouping.
- `api/_positions.js` — server normalization.
- `api/vote.js` — trusted server-side validation and tally update.
- `src/pages/StudentDashboard.jsx` — voter ballot screen.
- `tests/one-vote-per-position.test.mjs` — server/client parity and concurrency coverage.

Run `npm test` for the complete offline suite.
