// Avatar.tsx: a round picture, or the app's soft tint with initials (a group icon for groups).

import { core } from '../core/core';
import { usePhotos } from '../core/hooks';
import { hash, initials } from './format';
import { Icon } from './Icon';

type Props = {
  /** Picks the tint, so a person keeps their colour everywhere. */
  id: string;
  name: string;
  /** A photo value (`pk1:…` or a web address). */
  photo?: string | null;
  group?: boolean;
  size?: number;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
};

export function Avatar({ id, name, photo, group, size, className = '', onClick }: Props) {
  usePhotos();
  const url = core.photoUrl(photo);
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  const tint = `t${(hash(id) % 3) + 1}`;
  if (url) {
    return (
      <div className={`av ph ${className}`} style={style} onClick={onClick}>
        <img src={url} alt="" draggable={false} />
      </div>
    );
  }
  return (
    <div className={`av ${tint} ${className}`} style={style} onClick={onClick}>
      {group ? <Icon name="group" size={size ? Math.round(size * 0.54) : 26} /> : initials(name || '?')}
    </div>
  );
}

/** A person's photo value, from what the server last said about them. */
export const photoOf = (userId: string | null) => (userId ? (userId === core.myId ? (core.client.me?.me.photo ?? core.people[userId]?.photo) : core.people[userId]?.photo) : null);
