/**
 * ============================================================================
 *  BRAND CONFIG — THE ONLY FILE YOU EDIT TO REBRAND THIS PORTAL
 * ============================================================================
 *
 *  Every user-visible name, title, colour and prefix in the app is read from
 *  this object at runtime. Change a value here, save, and the whole portal
 *  changes: landing page, logins, dashboards, PDF result sheet, support
 *  autoresponder, PWA install prompt, page <title>, manifest, generated
 *  activation keys and the default staff password.
 *
 *  After editing, run:   npm run brand:sync
 *  That re-writes the static files that can't read JS at runtime
 *  (api/_brand.js, public/manifest.json and the <head> of index.html).
 *
 *  This is a plain .js file (not JSON) on purpose: Vite and Vercel's Node
 *  runtime can both import it without any extra build step.
 * ============================================================================
 */

const brand = {
  /* ---- Names -------------------------------------------------------------
   * name        : the short name members see in caps, e.g. "SMCOAA"
   * shortName   : 1-word app name for the PWA icon / install banner
   * fullName    : the association's full legal-ish name
   * school      : the institution, shown under the name
   */
  name: 'SMCOAA',
  shortName: 'SMCOAA',
  fullName: "St. Michael's College, Oleh Alumni Association",
  school: "St. Michael's College, Oleh",
  year: new Date().getFullYear(),

  /* ---- Who runs the election -------------------------------------------- */
  electoralBody: 'Electoral Commission',
  tagline: 'Alumni Election Portal',
  appTitle: 'Alumni Election Portal',
  copyrightHolder: "St. Michael's College, Oleh Alumni Association",

  /* ---- Colours (hex) ----------------------------------------------------- */
  colors: {
    primary: '#341D61', // crest purple
    primaryLight: '#50347B',
    accent: '#FFFFFF',
    dark: '#21143D',
    success: '#16a34a',
    danger: '#dc2626',
  },

  /* ---- Assets ----------------------------------------------------------- */
  logoPath: '/logo.png', // replace public/logo.png with the new logo

  /* ---- Technical identifiers --------------------------------------------
   * storagePrefix : prefix for every localStorage / IndexedDB / service-worker
   *                 cache key. Change it if two portals ever share a domain,
   *                 so the two portals can never read each other's cache.
   * keySuffix     : suffix on generated activation keys, e.g. "...-ABC123-<X>"
   */
  storagePrefix: 'smcoaa',
  keySuffix: '',

  /* ---- Deployment ------------------------------------------------------- */
  url: 'https://your-portal.vercel.app',
  supportEmail: 'support@example.org',
};

export default brand;

/* Convenience derived strings — use these in code instead of gluing it up. */
export const BRAND_STRINGS = {
  title: `${brand.name} ${brand.appTitle}`, // "SMCOAA Alumni Election Portal"
  titleUpper: `${brand.name} ${brand.appTitle}`.toUpperCase(),
  org: `${brand.name} ${brand.school}`, // "SMCOAA Oleh"
  commission: `${brand.name} ${brand.electoralBody}`, // "SMCOAA Electoral Commission"
  copyright: `${brand.name} ${brand.school}`,
};
