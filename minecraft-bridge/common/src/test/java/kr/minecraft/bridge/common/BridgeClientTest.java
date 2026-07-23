package kr.minecraft.bridge.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BridgeClientTest {
    @Test
    void hashingAndSigningAreStable() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", BridgeClient.sha256("abc"));
        assertEquals("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8", BridgeClient.hmac("key", "The quick brown fox jumps over the lazy dog"));
    }

    @Test
    void jsonEscapesControlCharacters() {
        assertEquals("\"a\\n\\\"b\"", Json.quote("a\n\"b"));
    }
}
