// In-app browsers (TikTok, Instagram, Snapchat, …) block Google sign-in and open email links in a different browser,
// so sign-in there uses a 6-digit email code instead.
const IN_APP = /\b(Instagram|FBAN|FBAV|FB_IAB|musical_ly|TikTok|BytedanceWebview|Snapchat|Line\/|LinkedInApp|Pinterest|Twitter|GSA\/)/i;

export function isInAppBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return IN_APP.test(ua || '');
}
