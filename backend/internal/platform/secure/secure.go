package secure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
)

func RandomToken(nBytes int) string {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Errorf("crypto/rand: %w", err))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func HexSHA256(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// BookingAlphabet excludes I, L, O and U to avoid confusion with 1, 0 and V when read aloud.
const BookingAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

func RandomCode(length int, alphabet string) string {
	out := make([]byte, length)
	max := big.NewInt(int64(len(alphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(fmt.Errorf("crypto/rand: %w", err))
		}
		out[i] = alphabet[n.Int64()]
	}
	return string(out)
}

func BookingNumber() string { return RandomCode(12, BookingAlphabet) }

// Cipher encrypts identity numbers with AES-256-GCM. Each ciphertext records the key ID that
// produced it, so keys can be rotated by adding a new active key while old ones stay readable.
type Cipher struct {
	keys     map[string]cipher.AEAD
	activeID string
}

func NewCipher(keys map[string][]byte, activeID string) (*Cipher, error) {
	c := &Cipher{keys: map[string]cipher.AEAD{}, activeID: activeID}
	for id, k := range keys {
		block, err := aes.NewCipher(k)
		if err != nil {
			return nil, fmt.Errorf("key %s: %w", id, err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		c.keys[id] = aead
	}
	if _, ok := c.keys[activeID]; !ok {
		return nil, errors.New("active key not found")
	}
	return c, nil
}

func (c *Cipher) ActiveKeyID() string { return c.activeID }

// Encrypt binds the ciphertext to associatedData (the owning record ID) so a value cannot be
// copied onto another record and still decrypt.
func (c *Cipher) Encrypt(plaintext, associatedData []byte) (ciphertext []byte, keyID string, err error) {
	aead := c.keys[c.activeID]
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, "", err
	}
	return aead.Seal(nonce, nonce, plaintext, associatedData), c.activeID, nil
}

func (c *Cipher) Decrypt(ciphertext []byte, keyID string, associatedData []byte) ([]byte, error) {
	aead, ok := c.keys[keyID]
	if !ok {
		return nil, fmt.Errorf("unknown key id %q", keyID)
	}
	if len(ciphertext) < aead.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	nonce, body := ciphertext[:aead.NonceSize()], ciphertext[aead.NonceSize():]
	return aead.Open(nil, nonce, body, associatedData)
}
