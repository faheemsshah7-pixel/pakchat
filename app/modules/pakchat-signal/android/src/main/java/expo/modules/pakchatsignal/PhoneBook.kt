package expo.modules.pakchatsignal

import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.os.Build
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import android.provider.ContactsContract.Data
import android.provider.ContactsContract.RawContacts

/**
 * The phone's own address book: where a contact can be saved (WhatsApp's "Save to":
 * a Google account, the phone, or the SIM), and saving one there. A contact saved to
 * a Google account is synced by Google to Gmail's contacts, like any other.
 */
object PhoneBook {
  class Account(val type: String?, val name: String?, val kind: String)

  /** "google", "sim", "phone" or "other", from an account's type. */
  fun kindOf(type: String?): String {
    val t = type?.lowercase() ?: return "phone"
    return when {
      t == "com.google" -> "google"
      "sim" in t || "icc" in t || "usim" in t -> "sim"
      "phone" in t || "local" in t || "device" in t -> "phone"
      else -> "other"
    }
  }

  /** Every place this phone can keep contacts. The phone itself is always there. */
  fun accounts(resolver: ContentResolver): List<Account> {
    val seen = LinkedHashMap<String, Account>()
    fun add(type: String?, name: String?) {
      if (type == null && name == null) return
      seen.putIfAbsent("$type|$name", Account(type, name, kindOf(type)))
    }
    // Accounts that sync contacts (a Google account shows here even with no contacts yet).
    resolver.query(ContactsContract.Settings.CONTENT_URI, arrayOf(ContactsContract.Settings.ACCOUNT_TYPE, ContactsContract.Settings.ACCOUNT_NAME), null, null, null)?.use {
      while (it.moveToNext()) add(it.getString(0), it.getString(1))
    }
    // Accounts that already hold contacts (phone and SIM accounts of some makers).
    resolver.query(RawContacts.CONTENT_URI, arrayOf(RawContacts.ACCOUNT_TYPE, RawContacts.ACCOUNT_NAME), "${RawContacts.DELETED}=0", null, null)?.use {
      while (it.moveToNext()) add(it.getString(0), it.getString(1))
    }
    // The SIM cards, on Android 12 and newer.
    if (Build.VERSION.SDK_INT >= 31) {
      try {
        for (sim in ContactsContract.SimContacts.getSimAccounts(resolver)) seen.putIfAbsent("${sim.accountType}|${sim.accountName}", Account(sim.accountType, sim.accountName, "sim"))
      } catch (_: Exception) {
        // Some phones don't let apps see their SIMs.
      }
    }
    val list = seen.values.filter { it.kind != "other" || it.type?.contains("google") == true }
    val phone = list.filter { it.kind == "phone" }.ifEmpty { listOf(Account(null, null, "phone")) }
    return list.filter { it.kind == "google" } + phone + list.filter { it.kind == "sim" }
  }

  /** Saves a contact into the given account (null type and name: the phone itself). Answers its id. */
  fun save(resolver: ContentResolver, type: String?, accountName: String?, name: String, phone: String?, email: String?): String {
    val ops = arrayListOf(
      ContentProviderOperation.newInsert(RawContacts.CONTENT_URI)
        .withValue(RawContacts.ACCOUNT_TYPE, type)
        .withValue(RawContacts.ACCOUNT_NAME, accountName)
        .build(),
      ContentProviderOperation.newInsert(Data.CONTENT_URI)
        .withValueBackReference(Data.RAW_CONTACT_ID, 0)
        .withValue(Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
        .withValue(StructuredName.DISPLAY_NAME, name)
        .build(),
    )
    if (!phone.isNullOrBlank()) {
      ops += ContentProviderOperation.newInsert(Data.CONTENT_URI)
        .withValueBackReference(Data.RAW_CONTACT_ID, 0)
        .withValue(Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
        .withValue(Phone.NUMBER, phone)
        .withValue(Phone.TYPE, Phone.TYPE_MOBILE)
        .build()
    }
    // A SIM can only keep a name and a number.
    if (!email.isNullOrBlank() && kindOf(type) != "sim") {
      ops += ContentProviderOperation.newInsert(Data.CONTENT_URI)
        .withValueBackReference(Data.RAW_CONTACT_ID, 0)
        .withValue(Data.MIMETYPE, Email.CONTENT_ITEM_TYPE)
        .withValue(Email.ADDRESS, email)
        .withValue(Email.TYPE, Email.TYPE_HOME)
        .build()
    }
    val result = resolver.applyBatch(ContactsContract.AUTHORITY, ops)
    return result[0].uri?.lastPathSegment ?: throw IllegalStateException("The phone didn't save the contact")
  }
}
