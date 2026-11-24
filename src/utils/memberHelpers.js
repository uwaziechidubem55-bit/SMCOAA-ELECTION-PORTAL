/**
 * MEMBER HELPERS — adapts the legacy voter identifier helper to SMCOAA's
 * fixed alumni roll. The old portal used a single matric number; this portal
 * uses the graduating set and register S/N to identify each member.
 *
 * In SMCOAA a voter is FOUR fields, held in src/config/members.js:
 *
 *     name   'Agberen Ezekiel'
 *     sex    'Male'
 *     set    1990                (the graduating set — "set of 1990")
 *     sn     1                   (the S/N from the register — doubles as the password)
 *
 * Everything the old helper did for one matric string, this file does for
 * those four fields: normalising, validating, building ids, and reading a
 * login. Nothing here generates anything — no keys, no PINs.
 */

/** The four fields that make a voter. */
export const MEMBER_FIELDS = ['name', 'sex', 'set', 'sn'];

/** The only values the register uses for sex. */
export const SEX_VALUES = ['Male', 'Female', 'Not specified', 'Prefer not to say'];

/* ------------------------------------------------------------------ *
 * SET + S/N
 * ------------------------------------------------------------------ */

/**
 * "set of 1990" / "SET OF 1990" / "Setof1990" / "set  of  1990" / "1990"
 *   -> 1990    (null if it is not a set)
 */
export function normaliseSet(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, ' ');
  const m = s.match(/^(?:set ?of ?)?(\d{4})$/);
  return m ? Number(m[1]) : null;
}

/** "1" / " 1 " / 1 -> 1. Anything that is not a whole number -> null. */
export function normaliseSn(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

/**
 * Reads the two login boxes.
 *   { username: 'set of 1990', password: '1' }  ->  { set: 1990, sn: 1 }
 * Returns null if either box does not make sense.
 */
export function parseLogin(username, password) {
  const set = normaliseSet(username);
  const sn = normaliseSn(password);
  if (set === null || sn === null) return null;
  return { set, sn };
}

/* ------------------------------------------------------------------ *
 * FIELDS
 * ------------------------------------------------------------------ */

export function isValidSex(sex) {
  return SEX_VALUES.includes(String(sex ?? '').trim());
}

/** A name is valid if it has something in it after trimming. */
export function isValidName(name) {
  return String(name ?? '').trim().length > 0;
}

/**
 * Checks one row of the register. Returns a list of problems — empty means good.
 * Used by the import script and by the tests so no bad row ever reaches the roll.
 */
export function validateMember(member) {
  const problems = [];
  if (!member || typeof member !== 'object') return ['not an object'];
  if (!isValidName(member.name)) problems.push('name is missing');
  if (!Number.isInteger(member.set) || member.set < 1900 || member.set > 2100) {
    problems.push(`set is not a year: ${member.set}`);
  }
  if (!Number.isInteger(member.sn) || member.sn < 1) problems.push(`sn is not a number: ${member.sn}`);
  if (!isValidSex(member.sex)) problems.push(`sex is not one of ${SEX_VALUES.join(', ')}: ${member.sex}`);
  return problems;
}

/* ------------------------------------------------------------------ *
 * IDS AND DISPLAY
 * ------------------------------------------------------------------ */

/**
 * The one id used everywhere — the Firestore doc id, the voted receipt key,
 * the one-vote-per-person record:
 *     { set: 1990, sn: 1 }  ->  "1990-1"
 */
export function memberDocId(set, sn) {
  const s = typeof set === 'object' && set !== null ? set.set : set;
  const n = typeof set === 'object' && set !== null ? set.sn : sn;
  return `${Number(s)}-${Number(n)}`;
}

/** "Set of 1990" — how the set is written on screen. */
export function setLabel(set) {
  return `Set of ${Number(set)}`;
}

/**
 * What the voter sees about themselves after login:
 *     "Agberen Ezekiel — Male, Set of 1990, S/N 1"
 */
export function describeMember(member) {
  if (!member) return '';
  return `${member.name} — ${member.sex}, ${setLabel(member.set)}, S/N ${member.sn}`;
}

/**
 * The four fields as they travel to the browser after a successful login.
 * Nothing else is sent — no passwords, no extra fields.
 */
export function publicMember(member) {
  if (!member) return null;
  return { name: member.name, sex: member.sex, set: member.set, sn: member.sn };
}

export default {
  MEMBER_FIELDS,
  SEX_VALUES,
  normaliseSet,
  normaliseSn,
  parseLogin,
  isValidSex,
  isValidName,
  validateMember,
  memberDocId,
  setLabel,
  describeMember,
  publicMember,
};
