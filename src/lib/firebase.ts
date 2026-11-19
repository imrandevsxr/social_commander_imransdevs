import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// In-memory cache of Google Drive OAuth access tokens keyed by Gmail address (never persisted in localStorage)
const driveTokenCache = new Map<string, string>();

export function getCachedDriveToken(email: string): string | undefined {
  return driveTokenCache.get(email.toLowerCase());
}

export function clearDriveTokenCache() {
  driveTokenCache.clear();
}

export async function signInWithGoogleForApp(): Promise<{
  user: User;
  idToken: string;
}> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

export async function connectGmailDrivePopup(): Promise<{
  email: string;
  displayName: string;
  accessToken: string;
}> {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google Drive access token was not granted in popup.');
  }

  const email = (result.user.email || '').toLowerCase();
  if (!email) {
    throw new Error('Could not read Gmail address from Google sign-in.');
  }

  driveTokenCache.set(email, credential.accessToken);
  return {
    email,
    displayName: result.user.displayName || email,
    accessToken: credential.accessToken,
  };
}
