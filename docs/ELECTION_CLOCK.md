# Election clock and operations

The API is authoritative for election timing. Admin settings use Nigerian local time (UTC+1); the voter interface displays the server-derived phase and schedule. Votes are accepted only while the server reports the election as live.

## Server behavior

- Election settings live in Firestore `settings/election`; activation state is mirrored to `settings/main` for the voter UI.
- `POST /api/student?action=electionStatus` is a public read-only status endpoint. It returns phase and public schedule fields only.
- `POST /api/vote` validates the election phase, resolves the member from `members/{set-sn}`, enforces one ballot per member and one selected candidate per position, then updates candidate totals and the member's `hasVoted` state transactionally.
- Admin Dashboard APIs require an admin session; Super Admin actions require both admin and Super Admin sessions. Election View APIs require a signed, expiring staff session.
- The browser Firestore client may read candidate display records and public election settings only. It cannot read the private member roll or write any Firestore data. Deploy `firestore.rules` before production use.

## Privacy / dashboard reporting

Voter login history uses the fixed membership roll fields (name, sex, set, S/N). Registration, matriculation numbers and PINs are not part of the SMCOAA voter flow. Admin and Election View turnout endpoints return only `hasVoted` flags. Super Admin reporting is restricted to its two-session authorization.

## Tests

Run the offline Firestore-mocked test suite with `npm test`. It covers election phases, voter access, vote limits, member data minimization, maintenance override and staff sessions.
