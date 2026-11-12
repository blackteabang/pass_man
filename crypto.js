/**
 * Secure Vault Cryptographic Helpers
 * Uses browser-native Web Crypto API (AES-GCM-256, PBKDF2)
 * Designed to be zero-dependency and fully compatible with file:// protocol.
 */
(function() {
    'use strict';

    // Helper: Convert ArrayBuffer to Base64 String
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    // Helper: Convert Base64 String to ArrayBuffer
    function base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Helper: Convert string to UTF-8 Uint8Array
    function stringToToUint8Array(str) {
        return new TextEncoder().encode(str);
    }

    // Helper: Convert Uint8Array to string
    function uint8ArrayToString(array) {
        return new TextDecoder().decode(array);
    }

    /**
     * Derive a key from password and salt using PBKDF2 with SHA-256.
     * @param {string} password - The master password.
     * @param {Uint8Array} salt - 16 bytes random salt.
     * @param {number} iterations - PBKDF2 iterations (default 600,000).
     * @returns {Promise<CryptoKey>} Derived AES key.
     */
    async function deriveKey(password, salt, iterations = 600000) {
        const baseKey = await window.crypto.subtle.importKey(
            "raw",
            stringToToUint8Array(password),
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        return await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: iterations,
                hash: "SHA-256"
            },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    /**
     * Encrypt plaintext string using master password.
     * @param {string} plaintext - The data to encrypt (e.g. JSON string).
     * @param {string} password - The master password.
     * @returns {Promise<object>} Encrypted payload with ciphertext, salt, and iv.
     */
    async function encrypt(plaintext, password) {
        try {
            // Generate secure random Salt (16 bytes) and IV (12 bytes)
            const salt = window.crypto.getRandomValues(new Uint8Array(16));
            const iv = window.crypto.getRandomValues(new Uint8Array(12));

            // Derive key
            const aesKey = await deriveKey(password, salt);

            // Encrypt data
            const encryptedBuffer = await window.crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                aesKey,
                stringToToUint8Array(plaintext)
            );

            return {
                ciphertext: arrayBufferToBase64(encryptedBuffer),
                salt: arrayBufferToBase64(salt),
                iv: arrayBufferToBase64(iv),
                version: "1.0"
            };
        } catch (e) {
            console.error("Encryption error:", e);
            throw new Error("암호화에 실패했습니다. 입력값을 확인해 주세요.");
        }
    }

    /**
     * Decrypt encrypted payload using master password.
     * @param {object} encryptedObj - Object containing ciphertext, salt, iv.
     * @param {string} password - The master password.
     * @returns {Promise<string>} Plaintext decrypted string.
     */
    async function decrypt(encryptedObj, password) {
        try {
            const salt = new Uint8Array(base64ToArrayBuffer(encryptedObj.salt));
            const iv = new Uint8Array(base64ToArrayBuffer(encryptedObj.iv));
            const ciphertext = base64ToArrayBuffer(encryptedObj.ciphertext);

            // Derive key using same salt and password
            const aesKey = await deriveKey(password, salt);

            // Decrypt data
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                aesKey,
                ciphertext
            );

            return uint8ArrayToString(decryptedBuffer);
        } catch (e) {
            console.error("Decryption error:", e);
            throw new Error("복호화에 실패했습니다. 비밀번호가 틀렸거나 데이터가 손상되었습니다.");
        }
    }

    const TRANSPORT_SALT = 'passmanage-transport-v1';

    async function openChannel(serverPublicKeyB64) {
        const serverPublic = await window.crypto.subtle.importKey(
            'spki',
            base64ToArrayBuffer(serverPublicKeyB64),
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        );
        const pair = await window.crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits']
        );
        const spki = await window.crypto.subtle.exportKey('spki', pair.publicKey);
        const shared = await window.crypto.subtle.deriveBits(
            { name: 'ECDH', public: serverPublic },
            pair.privateKey,
            256
        );
        const hkdfKey = await window.crypto.subtle.importKey(
            'raw',
            shared,
            'HKDF',
            false,
            ['deriveKey']
        );
        const aesKey = await window.crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: stringToToUint8Array(TRANSPORT_SALT),
                info: new Uint8Array(spki)
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        const publicKey = arrayBufferToBase64(spki);

        return {
            publicKey,
            async seal(plaintext) {
                const iv = window.crypto.getRandomValues(new Uint8Array(12));
                const encrypted = await window.crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: iv },
                    aesKey,
                    stringToToUint8Array(plaintext)
                );
                return {
                    v: 1,
                    ephemeralPublicKey: publicKey,
                    iv: arrayBufferToBase64(iv),
                    ciphertext: arrayBufferToBase64(encrypted)
                };
            },
            async open(envelope) {
                if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.ciphertext) {
                    throw new Error('서버 응답을 복호화하지 못했습니다.');
                }
                const bytes = await window.crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(envelope.iv)) },
                    aesKey,
                    base64ToArrayBuffer(envelope.ciphertext)
                );
                return uint8ArrayToString(new Uint8Array(bytes));
            }
        };
    }

    // Export cryptographic namespace to window
    window.VaultCrypto = {
        encrypt,
        decrypt,
        openChannel
    };
})();
