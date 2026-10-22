// phoneBook.ts: the phone's own contacts, with permission.
//
// Reading: finds who is on PakChat, the way WhatsApp does. Only names, numbers and
// email addresses are read, and they're hashed before they're sent (core.matchPhoneBook).
//
// Saving: like WhatsApp's "Save to", a new contact can also go into the phone's
// address book: a Google account (Google syncs it to your Gmail contacts), the
// phone itself, or the SIM card.
import type { ContactCard } from '@pakchat/shared';
import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts';
import KV from 'expo-sqlite/kv-store';

import { fileModule, type PhoneBookAccount } from '../../modules/pakchat-signal';
import { core } from './core';

/** Finds my phone's contacts on PakChat. Null when PakChat isn't allowed to see them. */
export async function findFromPhoneBook(): Promise<number | null> {
  const { granted } = await requestPermissionsAsync();
  if (!granted) return null;
  const all = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES, ContactField.EMAILS] as const);
  const cards: ContactCard[] = all
    .map((c) => ({
      name: c.fullName ?? '',
      phones: (c.phones ?? []).map((p) => p.number ?? '').filter(Boolean),
      emails: (c.emails ?? []).map((e) => e.address ?? '').filter(Boolean),
    }))
    .filter((c) => c.phones.length || c.emails.length);
  return core.matchPhoneBook(cards);
}

export type { PhoneBookAccount };

/** Where a new contact can be saved. Null when PakChat may not see contacts (and `ask` is false, or you said no). */
export async function phoneBookAccounts(ask: boolean): Promise<PhoneBookAccount[] | null> {
  const { granted } = ask ? await requestPermissionsAsync() : await getPermissionsAsync();
  if (!granted) return null;
  return fileModule().contactAccounts();
}

/** Saves a contact into the phone's address book, in the account picked. */
export function saveToPhoneBook(account: PhoneBookAccount, name: string, phone?: string, email?: string) {
  return fileModule().saveToPhoneBook(account.type, account.name, name, phone ?? null, email ?? null);
}

/** The "Save to" picked last time: an account's type|name, or "pakchat" for PakChat only. */
export function lastSaveTo(): string | null {
  return KV.getItemSync('saveTo');
}

export function rememberSaveTo(key: string) {
  KV.setItemSync('saveTo', key);
}

export const accountKey = (a: PhoneBookAccount) => `${a.type ?? ''}|${a.name ?? ''}`;
