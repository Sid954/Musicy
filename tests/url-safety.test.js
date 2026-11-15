const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHttpUrl, validatePublicHttpUrl, isPrivateIPv4, isPrivateIPv6 } = require('../src/music/sources/url-safety');
const generic = require('../src/music/sources/ytdlp-generic');
const youtube = require('../src/music/sources/youtube');

test('allows public HTTP(S) URLs and rejects other schemes or credentials', () => {
  assert.equal(validateHttpUrl('https://example.com/audio').hostname, 'example.com');
  assert.equal(validateHttpUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
  assert.equal(validateHttpUrl('http://8.8.8.8/media').hostname, '8.8.8.8');
  for (const value of ['file:///etc/passwd', 'ftp://example.com/file', 'https://user:pass@example.com/a', 'not a url']) {
    assert.throws(() => validateHttpUrl(value));
  }
});

test('blocks localhost, private, link-local, and reserved IP literals', () => {
  for (const ip of ['0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.2', '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.19.255.254', '198.51.100.1', '203.0.113.1', '224.0.0.1']) {
    assert.equal(isPrivateIPv4(ip), true, ip);
    assert.throws(() => validateHttpUrl(`http://${ip}/`), undefined, ip);
  }
  for (const host of ['localhost', 'printer.local', 'service.localhost']) {
    assert.throws(() => validateHttpUrl(`https://${host}/`));
  }
  assert.equal(isPrivateIPv6('::1'), true);
  assert.equal(isPrivateIPv6('fd00::1'), true);
  assert.throws(() => validateHttpUrl('http://[::1]/'));
  for (const address of ['::', '::1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:0a00:0001::1', 'fe80::1', 'fc00::1', 'ff02::1', '2001:db8::1']) {
    assert.equal(isPrivateIPv6(address), true, address);
    assert.throws(() => validateHttpUrl(`http://[${address}]/`), undefined, address);
  }
  assert.equal(isPrivateIPv6('::ffff:0808:0808'), false);
  assert.equal(isPrivateIPv6('64:ff9b::808:808'), false);
});

test('DNS validation rejects hosts resolving to private addresses', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ];
  await validatePublicHttpUrl('https://example.com/audio', publicLookup);
  await assert.rejects(validatePublicHttpUrl('https://example.com/audio', privateLookup), /private or reserved/);
  await assert.rejects(validatePublicHttpUrl('https://example.com/audio', async () => { throw new Error('DNS'); }), /could not be resolved/);
});

test('detects direct radio audio paths and preserves YouTube live metadata', () => {
  assert.equal(generic.isDirectAudioPath('https://radio.example/live.mp3?token=abc'), true);
  assert.equal(generic.isDirectAudioPath('https://radio.example/stream'), false);
  assert.equal(youtube.toTrack({ id: 'live-id', title: 'Live show', is_live: true }).isLive, true);
  const args = generic.buildRadioArgs('https://radio.example/live.mp3');
  assert.ok(args.indexOf('-protocol_whitelist') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'http,https,tcp,tls,crypto');
});

test('generic source claims public non-YouTube web URLs only', () => {
  assert.equal(generic.canHandle('https://soundcloud.com/artist/track'), true);
  assert.equal(generic.canHandle('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(generic.canHandle('file:///tmp/audio.mp3'), false);
  assert.equal(generic.canHandle('http://127.0.0.1:8080/audio'), false);
});
