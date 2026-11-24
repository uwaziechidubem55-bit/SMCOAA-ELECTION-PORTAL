import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MEMBERS } from '../src/config/members.js';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawServiceAccount) throw new Error('Set FIREBASE_SERVICE_ACCOUNT before seeding.');
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
const db = getFirestore();

const existing = await Promise.all(MEMBERS.map((member) =>
  db.doc(`members/${member.set}-${member.sn}`).get()
));
let batch = db.batch();
let writes = 0;
for (let i = 0; i < MEMBERS.length; i += 1) {
  const member = MEMBERS[i];
  const snap = existing[i];
  const ref = db.doc(`members/${member.set}-${member.sn}`);
  const data = {
    name: member.name,
    sex: member.sex,
    set: member.set,
    sn: member.sn,
    ...(snap.exists ? {} : { hasVoted: false }),
    updatedAt: new Date().toISOString(),
  };
  batch.set(ref, data, { merge: true });
  writes += 1;
  if (writes === 400) {
    await batch.commit();
    batch = db.batch();
    writes = 0;
  }
}
if (writes) await batch.commit();
console.log(`Seeded/updated ${MEMBERS.length} member records. Existing vote state was preserved.`);
