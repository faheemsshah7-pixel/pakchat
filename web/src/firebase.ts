// firebase.ts: connects our app to the PakChat Firebase project.
// These values are not secret. They only say WHICH project to talk to.
// What people are allowed to do is decided by the security rules on the server.
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDMQYIALJ7-hsgo0wBqM2cPYLy4W_S_2Tc',
  authDomain: 'pakchat-f89d8.firebaseapp.com',
  projectId: 'pakchat-f89d8',
  storageBucket: 'pakchat-f89d8.firebasestorage.app',
  messagingSenderId: '459861530466',
  appId: '1:459861530466:web:6c9bd62bbe0897d674be3b',
}

const app = initializeApp(firebaseConfig)

// auth = login. db = the Firestore database where users and messages live.
export const auth = getAuth(app)
export const db = getFirestore(app)
