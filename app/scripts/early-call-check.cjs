// early-call-check.cjs: checks the WebRTC steps behind "connect while ringing"
// (src/core/calls.ts, 2b at the top) in Chromium, whose libwebrtc is the engine
// react-native-webrtc uses. Two connections in one page, with pretend mic and camera:
//   - they connect while it rings, and nothing is sent (no sound, no picture);
//   - once answered, putting the tracks on the empty senders starts the sound at
//     once, without setting the connection up again;
//   - the caller gets the answering phone's tracks without a stream (calls.ts makes one).
// Run: node scripts/early-call-check.cjs   (needs Playwright's Chromium)
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const ORIGIN = 'http://localhost:9'; // localhost counts as secure (needed for the camera); answered below, no server
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await (await b.newContext({ permissions: ['microphone', 'camera'] })).newPage();
  await page.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>check</title>' }));
  await page.goto(`${ORIGIN}/`);
  const out = await page.evaluate(async () => {
    const log = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const caller = new RTCPeerConnection();
    const callee = new RTCPeerConnection();
    let negotiation = 0;
    caller.onnegotiationneeded = () => negotiation++;
    callee.onnegotiationneeded = () => negotiation++;
    caller.onicecandidate = (e) => e.candidate && callee.addIceCandidate(e.candidate).catch(() => {});
    callee.onicecandidate = (e) => e.candidate && caller.addIceCandidate(e.candidate).catch(() => {});
    const callerTracks = [];
    caller.ontrack = (e) => callerTracks.push({ kind: e.track.kind, streams: e.streams.length });
    const calleeTracks = [];
    callee.ontrack = (e) => calleeTracks.push({ kind: e.track.kind, streams: e.streams.length });
    // Caller: mic (and camera) on for its own preview, but senders empty.
    const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    for (const t of local.getTracks()) caller.addTransceiver(t.kind, { direction: 'sendrecv', streams: [local] });
    const offer = await caller.createOffer();
    await caller.setLocalDescription(offer);
    await callee.setRemoteDescription(offer);
    for (const t of callee.getTransceivers()) if (t.direction === 'recvonly') t.direction = 'sendrecv';
    const answer = await callee.createAnswer();
    await callee.setLocalDescription(answer);
    await caller.setRemoteDescription(answer);
    for (let i = 0; i < 50 && (caller.connectionState !== 'connected' || callee.connectionState !== 'connected'); i++) await wait(100);
    log.connectedWhileRinging = [caller.connectionState, callee.connectionState];
    await wait(1500);
    const rtp = async (pc, kind) => {
      let n = 0;
      (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === kind) n += s.packetsReceived || 0; });
      return n;
    };
    log.whileRinging = { calleeHearsCaller: await rtp(callee, 'audio'), callerHearsCallee: await rtp(caller, 'audio'), calleeSeesCaller: await rtp(callee, 'video') };
    const negBefore = negotiation;
    // Answered: callee opens its mic and camera; both put tracks on the empty senders.
    const mine = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const t0 = performance.now();
    for (const t of callee.getTransceivers()) { const tr = mine.getTracks().find((x) => x.kind === t.receiver.track.kind); if (tr && !t.sender.track) await t.sender.replaceTrack(tr); }
    for (const t of caller.getTransceivers()) { const tr = local.getTracks().find((x) => x.kind === t.receiver.track.kind); if (tr && !t.sender.track) await t.sender.replaceTrack(tr); }
    let first = null;
    for (let i = 0; i < 100; i++) { if ((await rtp(callee, 'audio')) > 0 && (await rtp(caller, 'audio')) > 0) { first = Math.round(performance.now() - t0); break; } await wait(20); }
    log.soundFlowsAfterAnswerMs = first;
    await wait(800);
    log.afterAnswer = { calleeHearsCaller: await rtp(callee, 'audio'), callerHearsCallee: await rtp(caller, 'audio'), callerSeesCallee: await rtp(caller, 'video') };
    log.renegotiationsNeeded = negotiation - negBefore;
    log.callerTrackEvents = callerTracks;
    log.calleeTrackEvents = calleeTracks;
    log.signaling = [caller.signalingState, callee.signalingState];
    return log;
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
  const ok =
    out.connectedWhileRinging.every((x) => x === 'connected') &&
    Object.values(out.whileRinging).every((n) => n === 0) &&
    out.soundFlowsAfterAnswerMs !== null &&
    out.afterAnswer.callerSeesCallee > 0 &&
    out.renegotiationsNeeded === 0;
  console.log(ok ? 'OK' : 'FAILED');
  process.exit(ok ? 0 : 1);
})();
