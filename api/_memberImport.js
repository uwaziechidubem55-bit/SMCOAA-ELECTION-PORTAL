import { SEX_VALUES } from '../src/utils/memberHelpers.js';

export const MAX_MEMBER_IMPORT_ROWS = 1000;
const MAX_CSV_CHARS = 1024 * 1024;

function parseCsvRows(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Choose a non-empty CSV file.');
  if (input.length > MAX_CSV_CHARS) throw new Error('CSV is too large. Keep it under 1 MB.');
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') {
      if (field.length) throw new Error('CSV has a misplaced quotation mark.');
      quoted = true;
    } else if (ch === ',') {
      row.push(field.trim()); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim()); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one member row.');
  if (rows.length - 1 > MAX_MEMBER_IMPORT_ROWS) throw new Error(`Import up to ${MAX_MEMBER_IMPORT_ROWS} members at a time.`);

  const normalizeHeader = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = rows[0].map(normalizeHeader);
  const find = names => headers.findIndex(h => names.includes(h));
  const indexes = {
    set: find(['set', 'setyear', 'year']),
    sn: find(['sn', 'serialnumber', 'serialno', 'number']),
    name: find(['name', 'fullname', 'membername']),
    sex: find(['sex', 'gender']),
  };
  const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([key]) => key);
  if (missing.length) throw new Error(`CSV is missing required column(s): ${missing.join(', ')}. Required headers: Set, S/N, Name, Sex.`);

  const members = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const line = i + 1;
    const setText = cells[indexes.set] || '';
    const snText = cells[indexes.sn] || '';
    const name = (cells[indexes.name] || '').trim();
    const sex = (cells[indexes.sex] || '').trim();
    if (!/^\d{4}$/.test(setText)) throw new Error(`Row ${line}: Set must be a four-digit year.`);
    const set = Number(setText);
    if (set < 1900 || set > 2100) throw new Error(`Row ${line}: Set year is outside the allowed range.`);
    if (!/^\d{1,4}$/.test(snText) || Number(snText) < 1) throw new Error(`Row ${line}: S/N must be a whole number from 1 to 9999.`);
    if (!name || name.length > 120) throw new Error(`Row ${line}: Name is required and must be no more than 120 characters.`);
    if (!SEX_VALUES.includes(sex)) throw new Error(`Row ${line}: Sex must be one of ${SEX_VALUES.join(', ')}.`);
    const sn = Number(snText);
    const id = `${set}-${sn}`;
    if (seen.has(id)) throw new Error(`Row ${line}: Duplicate Set/S/N ${id} in this file.`);
    seen.add(id);
    members.push({ set, sn, name, sex });
  }
  return members;
}

export function validateMemberRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_MEMBER_IMPORT_ROWS) {
    throw new Error(`Member list must contain between 1 and ${MAX_MEMBER_IMPORT_ROWS} records.`);
  }
  const seen = new Set();
  return rows.map((row, index) => {
    const set = Number(row?.set);
    const sn = Number(row?.sn);
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const sex = typeof row?.sex === 'string' ? row.sex.trim() : '';
    const line = index + 1;
    if (!Number.isInteger(set) || set < 1900 || set > 2100) throw new Error(`Row ${line}: Invalid set year.`);
    if (!Number.isInteger(sn) || sn < 1 || sn > 9999) throw new Error(`Row ${line}: S/N must be from 1 to 9999.`);
    if (!name || name.length > 120) throw new Error(`Row ${line}: Name is required and must be no more than 120 characters.`);
    if (!SEX_VALUES.includes(sex)) throw new Error(`Row ${line}: Invalid sex value.`);
    const id = `${set}-${sn}`;
    if (seen.has(id)) throw new Error(`Row ${line}: Duplicate Set/S/N ${id}.`);
    seen.add(id);
    return { set, sn, name, sex };
  });
}

export function parseMemberCsv(csvText) {
  return parseCsvRows(csvText);
}

export async function previewMembers(db, rows) {
  const members = validateMemberRows(rows);
  const snapshot = await db.collection('members').get();
  const existing = new Set(snapshot.docs.map(doc => doc.id));
  const alreadyPresent = members.filter(m => existing.has(`${m.set}-${m.sn}`)).length;
  return { total: members.length, toCreate: members.length - alreadyPresent, alreadyPresent };
}

export async function addNewMembers(db, rows) {
  const members = validateMemberRows(rows);
  const snapshot = await db.collection('members').get();
  const existing = new Set(snapshot.docs.map(doc => doc.id));
  const newMembers = members.filter(m => !existing.has(`${m.set}-${m.sn}`));
  let batch = db.batch();
  let pending = 0;
  for (const member of newMembers) {
    const ref = db.doc(`members/${member.set}-${member.sn}`);
    // Create-only semantics: never overwrite a current voter or change hasVoted.
    batch.create(ref, { ...member, hasVoted: false, createdAt: new Date().toISOString() });
    pending += 1;
    if (pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending) await batch.commit();
  return { total: members.length, created: newMembers.length, alreadyPresent: members.length - newMembers.length };
}
