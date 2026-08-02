import { describe, expect, test } from 'vitest';

import {
    clampRemotePort,
    createPasswordHash,
    normalizeBindAddress,
    verifyPassword
} from '../remoteAccessSecurity';

describe('remoteAccessSecurity', () => {
    test('hashes and verifies passwords without storing plaintext', async () => {
        const hash = await createPasswordHash('secret-password');

        expect(hash).toMatch(/^pbkdf2-sha256:/);
        expect(hash).not.toContain('secret-password');
        await expect(verifyPassword('secret-password', hash)).resolves.toBe(
            true
        );
        await expect(verifyPassword('wrong-password', hash)).resolves.toBe(
            false
        );
    });

    test('clamps invalid remote ports', () => {
        expect(clampRemotePort('abc')).toBe(23580);
        expect(clampRemotePort(80)).toBe(1024);
        expect(clampRemotePort(70000)).toBe(65535);
        expect(clampRemotePort(23580)).toBe(23580);
    });

    test('normalises remote bind addresses to IPv4 literals only', () => {
        expect(normalizeBindAddress('')).toBe('');
        expect(normalizeBindAddress('0.0.0.0')).toBe('');
        expect(normalizeBindAddress('*')).toBe('');
        expect(normalizeBindAddress('192.168.1.10')).toBe('192.168.1.10');
        expect(normalizeBindAddress(' 192.168.1.10 ')).toBe('192.168.1.10');
        // Rejects hostnames, IPv6, malformed and out-of-range literals.
        expect(normalizeBindAddress('localhost')).toBe('');
        expect(normalizeBindAddress('::1')).toBe('');
        expect(normalizeBindAddress('192.168.1')).toBe('');
        expect(normalizeBindAddress('999.1.1.1')).toBe('');
        expect(normalizeBindAddress('a.b.c.d')).toBe('');
    });
});
