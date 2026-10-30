// device.ts: is this a phone? The website is made for computers; phones get the app.

export const onPhone = /Android.+Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent) && Math.min(screen.width, screen.height) < 600;
export const onAndroid = /Android/i.test(navigator.userAgent);

/** Google Play's page for PakChat, once it's public there (set when the website is built). */
export const PLAY_URL = (import.meta.env.VITE_PLAY_URL as string | undefined) || '';
/** Until then, the app itself, downloaded straight from our server. */
export const APK_URL = '/pakchat.apk';
export const APP_URL = PLAY_URL || APK_URL;
