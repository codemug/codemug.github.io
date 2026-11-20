import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDomain, validateIPv4, validateIPv6, validateUrl, buildPtrName, formatDnsAnswer } from '../scripts/pc/nettools/net.mjs';
import { computeSubnet } from '../scripts/pc/nettools/subnet.mjs';

test('subnet v4 /24: 10.0.0.0/24 gives network, broadcast, mask, 256 addresses', () => {
  const r = computeSubnet('10.0.0.0/24');
  assert.equal(r.version, 4);
  assert.equal(r.network, '10.0.0.0');
  assert.equal(r.broadcast, '10.0.0.255');
  assert.equal(r.first, '10.0.0.1');
  assert.equal(r.last, '10.0.0.254');
  assert.equal(r.mask, '255.255.255.0');
  assert.equal(r.count, 256n);
  assert.equal(r.countStr, '256');
});

test('subnet v4 /31: point-to-point, 2 addresses, both usable (RFC 3021)', () => {
  const r = computeSubnet('192.168.1.4/31');
  assert.equal(r.network, '192.168.1.4');
  assert.equal(r.broadcast, '192.168.1.5');
  assert.equal(r.first, '192.168.1.4');
  assert.equal(r.last, '192.168.1.5');
  assert.equal(r.count, 2n);
});

test('subnet v6 /64: network, first/last and the 2^64 count as BigInt', () => {
  const r = computeSubnet('2001:db8::/64');
  assert.equal(r.version, 6);
  assert.equal(r.network, '2001:db8::');
  assert.equal(r.broadcast, null);
  assert.equal(r.first, '2001:db8::');
  assert.equal(r.last, '2001:db8::ffff:ffff:ffff:ffff');
  assert.equal(r.mask, 'ffff:ffff:ffff:ffff::');
  assert.equal(r.count, 18446744073709551616n); // 2**64
});

test('subnet rejects bad input', () => {
  assert.throws(() => computeSubnet('10.0.0.0'), /prefix/i);
  assert.throws(() => computeSubnet('10.0.0.0/33'), /prefix is 0/);
  assert.throws(() => computeSubnet('nope/24'), /not a valid/i);
  assert.throws(() => computeSubnet('2001:db8::/0'), /prefix is 1/);
});

test('validateDomain: accepts FQDNs, rejects partial/invalid domains', () => {
  assert.equal(validateDomain('example.com').ok, true);
  assert.equal(validateDomain('sub.example.co.uk').value, 'sub.example.co.uk');
  for (const bad of ['com', 'exa mple.com', 'example..com', 'example.com:80', '-bad.com', 'x'.repeat(250) + '.com', '']) {
    assert.equal(validateDomain(bad).ok, false, `must reject: ${JSON.stringify(bad.slice(0, 30))}`);
  }
});

test('validateIPv4: strict dotted-quad, no leading zeros', () => {
  const ok = validateIPv4('1.2.3.4');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.octets, [1, 2, 3, 4]);
  for (const bad of ['1.2.3.256', '01.2.3.4', '1.2.3', '1.2.3.4.5', 'a.b.c.d', '1.2.3. ']) {
    assert.equal(validateIPv4(bad).ok, false, `must reject: ${JSON.stringify(bad)}`);
  }
});

test('validateIPv6: accepts compressed and mixed forms, rejects garbage', () => {
  assert.equal(validateIPv6('2001:db8::1').ok, true);
  assert.equal(validateIPv6('::1').ok, true);
  assert.equal(validateIPv6('2001:db8::1.2.3.4').ok, true); // embedded IPv4 tail
  assert.equal(validateIPv6('fe80::ffff:ffff:ffff:ffff').ok, true);
  for (const bad of ['2001:db8:::1', '1.2.3.4', '2001:db8::g', '2001:db8::1:2:3:4:5:6:7', '']) {
    assert.equal(validateIPv6(bad).ok, false, `must reject: ${JSON.stringify(bad)}`);
  }
});

test('validateUrl: https only', () => {
  assert.equal(validateUrl('https://example.com/a?b=1').ok, true);
  assert.equal(validateUrl('http://example.com').ok, false);
  assert.equal(validateUrl('not a url').ok, false);
});

test('buildPtrName: v4 and v6 reverse names; throws on non-IP', () => {
  assert.equal(buildPtrName('2001:db8::1'), '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
  assert.equal(buildPtrName('9.9.9.9'), '9.9.9.9.in-addr.arpa');
  assert.throws(() => buildPtrName('nope'), /valid IP/);
});

test('formatDnsAnswer: A, TXT (array), MX, NS, CAA, SOA and empty', () => {
  assert.deepEqual(formatDnsAnswer({ Answer: [{ Type: 1, Data: '93.184.216.34' }] }), ['93.184.216.34']);
  assert.deepEqual(formatDnsAnswer({ Answer: [{ Type: 16, Data: ['v=spf1 -all', 'other'] }] }), ['v=spf1 -all  other']);
  assert.deepEqual(formatDnsAnswer({ Answer: [{ Type: 15, Data: 'mail.example.com' }] }), ['mail.example.com']);
  assert.deepEqual(formatDnsAnswer({ Answer: [{ Type: 2, Data: ['ns1.example.com', 'ns2.example.com'] }] }), ['ns1.example.com, ns2.example.com']);
  assert.deepEqual(formatDnsAnswer({ Answer: [{ Type: 51, Data: [{ flag: 0, tag: 'issue', value: 'letsencrypt.org' }] }] }), ['0 issue "letsencrypt.org"']);
  const soa = { Type: 6, Data: { ns: 'ns1.example.com', hostmaster: 'admin.example.com', serial: 1, refresh: 3600 } };
  assert.deepEqual(formatDnsAnswer({ Answer: [soa] }), [JSON.stringify(soa.Data)]);
  assert.deepEqual(formatDnsAnswer({}), []);
  assert.deepEqual(formatDnsAnswer(null), []);
});

import { summarizeRdap, summarizeCrtsh, summarizeInternetDb } from '../scripts/pc/nettools/domain.mjs';

const rdapDomain = {
  ldhName: 'example.com',
  status: ['active'],
  nameservers: [{ ldhName: 'ns1.example.com' }, { ldhName: 'ns2.example.com' }],
  events: [
    { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2026-08-13T04:00:00Z' },
  ],
  entities: [{ roles: ['registrar'], handle: '1598', vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Example Registrar']]] }],
};

test('summarizeRdap: registrar, dates, status, nameservers for domain and IP shapes', () => {
  const text = summarizeRdap(rdapDomain);
  assert.match(text, /Registrar: Example Registrar/);
  assert.match(text, /Registrar ID: 1598/);
  assert.match(text, /registration: 1995-08-14/);
  assert.match(text, /expiration: 2026-08-13/);
  assert.match(text, /Status: active/);
  assert.match(text, /Nameservers: ns1\.example\.com, ns2\.example\.com/);
  // object-form vcard (shape b): value at [2] of the named property
  const ip = { cidr0c: '8.8.8.0/24', entities: [{ roles: ['registrar'], vcardArray: ['version', [], { fn: ['text', {}, 'Google LLC'] }] }] };
  assert.match(summarizeRdap(ip), /Network: 8\.8\.8\.0\/24/);
  assert.match(summarizeRdap(ip), /Registrar: Google LLC/);
  assert.equal(summarizeRdap(null), 'Empty RDAP response.');
});

test('summarizeCrtsh: dedupes names across rows, caps at 200, empty input', () => {
  const rows = [
    { name_value: '*.example.com\nexample.com' },
    { name_value: 'example.com' },
    { name_value: 'sub.example.com' },
  ];
  const s = summarizeCrtsh(rows);
  assert.equal(s.count, 3);
  assert.equal(s.total, 3);
  assert.deepEqual(s.names, ['*.example.com', 'example.com', 'sub.example.com']);
  assert.equal(s.capped, false);
  const big = Array.from({ length: 300 }, (_, i) => ({ name_value: `h${i}.example.com` }));
  const c = summarizeCrtsh(big);
  assert.equal(c.total, 300);
  assert.equal(c.names.length, 200);
  assert.equal(c.capped, true);
  assert.deepEqual(summarizeCrtsh([]), { count: 0, total: 0, names: [], capped: false });
});

test('summarizeInternetDb: ports sorted+deduped, vulns with scores, empty report', () => {
  const text = summarizeInternetDb({
    ip: '8.8.8.8', os: 'Linux 5.10', cpe: 'cpe:2.3:o:linux:linux_kernel:5.10',
    hostnames: ['dns.google', 'dns.google', '8.8.8.8.in-addr.arpa'],
    ports: [443, 53, 443, 80],
    vulns: [{ id: 'CVE-2021-44228', score: 10 }, { id: 'CVE-1999-0001' }],
  });
  assert.match(text, /OS: Linux 5\.10/);
  assert.match(text, /Hostnames: dns\.google, 8\.8\.8\.8\.in-addr\.arpa/);
  assert.match(text, /Ports: 53, 80, 443/);
  assert.match(text, /CVE-2021-44228 \(score 10\); CVE-1999-0001/);
  const none = summarizeInternetDb({ ip: '1.2.3.4' });
  assert.match(none, /Ports: none reported/);
  assert.match(none, /Vulnerabilities: none reported/);
});

import { buildGlobalpingRequest, formatGlobalping } from '../scripts/pc/nettools/globalping.mjs';

test('buildGlobalpingRequest: defaults, custom values, and rejections', () => {
  assert.deepEqual(buildGlobalpingRequest({ type: 'ping', target: 'example.com' }),
    { type: 'ping', target: 'example.com', locations: [{ magic: 'world' }], limit: 3 });
  assert.deepEqual(buildGlobalpingRequest({ type: 'traceroute', target: 'Example.COM', magic: 'berlin, germany', limit: '5' }),
    { type: 'traceroute', target: 'example.com', locations: [{ magic: 'berlin, germany' }], limit: 5 });
  assert.deepEqual(buildGlobalpingRequest({ type: 'mtr', target: 'example.com', magic: '   ' }).locations[0].magic, 'world'); // blank falls back
  assert.throws(() => buildGlobalpingRequest({ type: 'icmp', target: 'example.com' }), /type/);
  assert.throws(() => buildGlobalpingRequest({ type: 'ping', target: 'nope' }), /domain/i);
  assert.throws(() => buildGlobalpingRequest({ type: 'ping', target: 'example.com', limit: 0 }), /Limit/);
  assert.throws(() => buildGlobalpingRequest({ type: 'ping', target: 'example.com', limit: 6 }), /Limit/);
  assert.throws(() => buildGlobalpingRequest({ type: 'ping', target: 'example.com', limit: 2.5 }), /Limit/);
});

test('formatGlobalping: real API shape — ping stats and traceroute hops', () => {
  const data = {
    target: 'example.com', type: 'ping',
    results: {
      '0': {
        probe: { city: 'Falkenstein', country: 'DE', network: 'Hetzner Online' },
        result: { status: 'finished', timings: [{ ttl: 58, rtt: 17.8 }], stats: { min: 17.763, max: 17.901, avg: 17.815, total: 3, rcv: 3 } },
      },
    },
  };
  const text = formatGlobalping(data);
  assert.match(text, /1 probe\(s\) for example\.com via Globalping/);
  assert.match(text, /Probe 0 — Falkenstein, DE \(Hetzner Online\):/);
  assert.match(text, /RTT min 17\.8 ms, max 17\.9 ms, avg 17\.8 ms \(3\/3 received\), TTL 58/);
  const tr = {
    target: 'example.com', type: 'traceroute',
    results: {
      '0': {
        probe: { city: 'NYC', country: 'US', network: 'Akamai' },
        result: { status: 'finished', hops: [{ resolvedAddress: '10.0.0.1', resolvedHostname: 'gw', timings: [{ rtt: 1.2 }, { rtt: 1.4 }] }, { resolvedAddress: '93.184.216.34', resolvedHostname: 'example.com', timings: [{ rtt: 12.1 }] }] },
      },
    },
  };
  const t2 = formatGlobalping(tr);
  assert.match(t2, /Probe 0 — NYC, US \(Akamai\):/);
  assert.match(t2, /hop 1: 10\.0\.0\.1 \(gw\) 1\.3 ms/);
  assert.match(t2, /hop 2: 93\.184\.216\.34 \(example\.com\) 12\.1 ms/);
  assert.equal(formatGlobalping({}), 'No probe results (yet).');
});

import { summarizeLatency } from '../scripts/pc/nettools/latency.mjs';

test('summarizeLatency: min/avg/max over samples, rejects when none completed', () => {
  assert.deepEqual(summarizeLatency([10.0, 20.0, 30.5]), { n: 3, min: 10, avg: 20.2, max: 30.5 });
  assert.throws(() => summarizeLatency([]), /No completed/);
});
