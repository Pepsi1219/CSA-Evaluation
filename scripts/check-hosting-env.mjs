import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), 'VITE_FIREBASE_');
const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
];

const missing = required.filter(key => !env[key]?.trim());
if (missing.length) {
    throw new Error(`Firebase Hosting build requires: ${missing.join(', ')}`);
}

if (env.VITE_FIREBASE_PROJECT_ID !== 'ie-calc'
    || env.VITE_FIREBASE_AUTH_DOMAIN !== 'ie-calc.firebaseapp.com') {
    throw new Error('Firebase Hosting build must target the existing ie-calc project.');
}

console.log('Firebase Hosting build configuration is complete for ie-calc.');
