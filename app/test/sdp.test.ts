import { describe, expect, test } from 'vitest';

import { tuneSdp } from '../src/core/sdp';

const sdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=0', 'a=rtpmap:63 red/48000/2', ''].join('\r\n');

describe('call sound settings', () => {
  test('Opus fills in lost packets and goes quiet in silences', () => {
    const out = tuneSdp(sdp);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n');
    expect(out.split('\r\n').length).toBe(sdp.split('\r\n').length);
  });

  test('adds the settings when Opus has none, and leaves SDP without Opus alone', () => {
    const bare = 'v=0\r\na=rtpmap:111 opus/48000/2\r\na=rtpmap:96 VP8/90000\r\n';
    expect(tuneSdp(bare)).toBe('v=0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 useinbandfec=1;usedtx=1\r\na=rtpmap:96 VP8/90000\r\n');
    const video = 'v=0\r\na=rtpmap:96 VP8/90000\r\n';
    expect(tuneSdp(video)).toBe(video);
  });
});
