/**
 * Build-time feature flags.
 *
 * This lives in its own module on purpose. It used to be exported from
 * App.jsx, which MoreSheet imported — and App.jsx imports BottomNav, which
 * imports MoreSheet. That circle meant MoreSheet could evaluate before App's
 * module body had run, giving "Cannot access 'GAMES_ENABLED' before
 * initialization". The production bundle happened to order the chunks so it
 * didn't blow up, which is the worst kind of latent bug: it works until an
 * unrelated import changes and then the whole app is a blank screen.
 *
 * A leaf module with no imports of its own cannot participate in a cycle.
 */

/**
 * Iranian app stores (Bazaar, Myket) and Google Play restrict gambling-styled
 * content, and the arcade — even on valueless points — reads as gambling to a
 * reviewer. Setting VITE_DISABLE_GAMES=true removes those routes entirely
 * rather than hiding them, so the code isn't even present in the APK for
 * someone to find by unzipping it.
 */
export const GAMES_ENABLED = import.meta.env?.VITE_DISABLE_GAMES !== 'true';
