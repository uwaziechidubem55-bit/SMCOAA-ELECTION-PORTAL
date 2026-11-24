# SMCOAA Election Portal — deployment and environment setup

The project is a separate portal from NAMATL. Deployment target is Vercel; database is Firebase Firestore; candidate media uses Cloudinary.

## Create the Vercel project

1. Import `uwaziechidubem55-bit/SMCOAA-ELECTION-PORTAL` in Vercel.
2. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`. Set the Vercel Node.js runtime to **20.x or newer** (the project declares Node `>=20`). The build also checks that the fixed voter roll is absent from browser bundles.
3. Add the environment variables below under **Project → Settings → Environment Variables**. Apply to the deployment environments you use, then redeploy after changing values.

## Credentials the owner supplies

- `ADMIN_USERNAME` — Admin Dashboard login username.
- `ADMIN_PASSWORD` — Admin Dashboard login password.
- `STAFF_PASSWORD` — Election View shared password.

The code reads these values from the Vercel server environment. The Election View password has no hard-coded fallback. Do not put real passwords in source control or in the public `VITE_*` variables.

## Firebase / Firestore (set up later)

The browser does not connect directly to Firebase. All Firestore operations use Vercel API routes and the Firebase Admin SDK, so Firestore can use deny-all client rules. Public ballot responses are limited to candidate display fields and voter-facing election settings; member documents stay server-side.

Server-side Admin SDK:

- `FIREBASE_SERVICE_ACCOUNT` — service-account JSON serialized as one environment-variable value.
- `SERVER_SESSION_SECRET` — at least 32 random characters, used to sign all admin, Super Admin, and Election View sessions. The API fails closed if it is missing or shorter.

Voter login and vote recording require Firestore documents under `members/{set-sn}`. The UI and API can be built before the Firebase project is configured, but those operations require the Firebase project and member data to be loaded before they can work in production.

## Cloudinary

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Keep the API secret server-side; never prefix it with `VITE_`.

## Local development

```sh
cp .env.example .env.local
npm install
npm run dev
```

Fill local environment values only when the corresponding Firebase/Cloudinary services are ready. Do not commit `.env.local` or credentials.

## Firestore security rules

`firestore.rules` is included with this project. Deploy it to the Firebase project before enabling the browser app (Firebase CLI: `firebase deploy --only firestore:rules`). Browser reads are limited to public candidate cards and public election schedule/settings; writes and access to the member roll, presence, audit, and support collections are denied. All mutations and private reads go through authenticated serverless APIs using the Firebase Admin SDK. Keep the service account private and grant it only the required Firestore permissions.

Election View and the Admin Dashboard receive turnout flags only, not the member names or S/N credentials. Keep the fixed roll out of the browser bundle; run `npm run seed:members` from a trusted environment after setting `FIREBASE_SERVICE_ACCOUNT`.

## Official support contact

After signing into Admin Dashboard, open **Election Settings → Official Support Contact** to enter the association's email address (including Yahoo) and/or phone number. Either field may be left blank and updated later. The values are stored in `settings/main` and only those two public contact fields are exposed through `GET /api/support`; they appear on the Support and Privacy pages as clickable email/phone links. Support-form messages continue to be stored for administrators, and replies can be sent to the sender's submitted email from the Admin Messages view.

## Audit & Verification Dashboard

The read-only Audit & Verification Dashboard is available from Super Admin and reuses the existing dual-lock signed Super Admin session. It compares member vote flags with distinct ballot audit events, summarizes candidate totals by position, shows identity-safe recent audit activity, and exports a CSV. A count mismatch is a review signal, not a finding of wrongdoing. It has no write action for votes or election settings.
