import * as Linking from "expo-linking";

/**
 * The invite, as something you can send somebody.
 *
 * A CUSTOM SCHEME AND NOTHING ELSE. No universal link, no associated domain, no
 * third-party link service: a Universal Link needs an apple-app-site-association
 * file on a domain this product does not yet serve, and a link shortener would
 * put every invite code through somebody else's server and log it there. The
 * code is in the message text as well as in the link, so a recipient who does
 * not have the app installed — for whom the scheme resolves to nothing — can
 * still type eight characters into Join.
 *
 * That ordering is deliberate in the share text too: the code first, the link
 * second. The code always works; the link only works on a device that already
 * has PersoNewsAP.
 */
export function inviteDeepLink(code: string): string {
  // `/join` rather than `/(teams)/join`: an Expo Router group is not part of a
  // URL path, so this resolves to the same screen and reads like a link.
  return Linking.createURL("/join", { queryParams: { code } });
}

export function inviteShareText(input: {
  code: string;
  message: string;
}): string {
  return `${input.message}\n${inviteDeepLink(input.code)}`;
}
