// sdp.ts: small changes to a call's description (SDP) before it goes, for
// steadier sound on poor networks, as WhatsApp's calls do:
//
//   useinbandfec=1  each sound packet carries a rough copy of the one before,
//                   so a lost packet is filled in instead of a gap
//   usedtx=1        nothing is sent during silence, which leaves more room
//                   for the words on a weak connection
//
// Kept free of WebRTC so it can be tested on a computer (test/sdp.test.ts).

/** The SDP with Opus (the voice codec) set to fill in lost packets and go quiet in silences. */
export function tuneSdp(sdp: string) {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(nl);
  // Which payload number is Opus ("a=rtpmap:111 opus/48000/2").
  const opus = lines.map((l) => /^a=rtpmap:(\d+) opus\/48000/i.exec(l)?.[1]).find(Boolean);
  if (!opus) return sdp;
  const want: Record<string, string> = { useinbandfec: '1', usedtx: '1' };
  let found = false;
  const out = lines.map((l) => {
    if (!l.startsWith(`a=fmtp:${opus} `)) return l;
    found = true;
    const params = l.slice(`a=fmtp:${opus} `.length).split(';').filter(Boolean);
    const keys = new Set(params.map((p) => p.split('=')[0].trim()));
    const kept = params.map((p) => {
      const key = p.split('=')[0].trim();
      return key in want ? `${key}=${want[key]}` : p;
    });
    for (const [k, v] of Object.entries(want)) if (!keys.has(k)) kept.push(`${k}=${v}`);
    return `a=fmtp:${opus} ${kept.join(';')}`;
  });
  if (found) return out.join(nl);
  // No fmtp line for Opus yet: one goes straight after its rtpmap.
  const at = out.findIndex((l) => l.startsWith(`a=rtpmap:${opus} `));
  out.splice(at + 1, 0, `a=fmtp:${opus} useinbandfec=1;usedtx=1`);
  return out.join(nl);
}
