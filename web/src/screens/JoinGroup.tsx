// JoinGroup.tsx: the window you see when you open a group's invite link.
// It shows the group's name and a Join button. (See invites.ts for how links work.)
// A community's link looks the same, and joins the community (communities.ts).
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Person } from '../chats'
import { joinCommunity } from '../communities'
import { joinGroup, lookupInvite, type Invite } from '../invites'
import { useT } from '../lang'
import Avatar from './Avatar'
import Modal from './Modal'

type Props = { me: Person; code: string; onClose: () => void; onJoined: (chatId: string) => void; onJoinedCommunity: (id: string) => void }

export default function JoinGroup({ me, code, onClose, onJoined, onJoinedCommunity }: Props) {
  const { t } = useT()
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined) // undefined = loading
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let stillHere = true
    lookupInvite(code)
      .then(async (found) => {
        if (!stillHere) return
        // Already in the group (or community)? Then just open it. (You can only see a community you're in.)
        if (found?.communityId) {
          const inside = await getDoc(doc(db, 'communities', found.communityId)).then((snap) => snap.exists(), () => false)
          if (inside && stillHere) return onJoinedCommunity(found.communityId)
        } else if (found) {
          const inside = await getDoc(doc(db, 'chats', found.chatId)).then((snap) => snap.get('members')?.includes(me.uid), () => false)
          if (inside && stillHere) return onJoined(found.chatId)
        }
        if (stillHere) setInvite(found)
      })
      .catch((err) => {
        console.error(err)
        if (stillHere) setInvite(null)
      })
    return () => {
      stillHere = false
    }
  }, [code, me.uid, onJoined, onJoinedCommunity])

  async function join() {
    if (!invite) return
    setBusy(true)
    setError('')
    try {
      if (invite.communityId) {
        await joinCommunity(me, { ...invite, communityId: invite.communityId })
        onJoinedCommunity(invite.communityId)
      } else {
        await joinGroup(me, invite)
        onJoined(invite.chatId)
      }
    } catch (err) {
      console.error(err)
      setError(t.linkNotWorking)
      setBusy(false)
    }
  }

  return (
    <Modal title={invite?.communityId ? t.communityInvite : t.groupInvite} onClose={onClose} className="narrow">
      {invite === undefined && <p className="hint center">{t.loading}</p>}
      {invite === null && <p className="error">{t.linkNotWorking}</p>}
      {invite && (
        <div className="info-hero">
          <Avatar name={invite.title} group community={!!invite.communityId} size={88} />
          <h3 dir="auto">{invite.title}</h3>
          <p>{invite.communityId ? t.invitedToCommunity : t.invitedToJoin}</p>
          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={busy} onClick={join}>
            {busy ? t.joining : invite.communityId ? t.joinCommunity : t.joinGroup}
          </button>
        </div>
      )}
    </Modal>
  )
}
