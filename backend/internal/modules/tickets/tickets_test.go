package tickets

import (
	"bytes"
	"testing"
)

func TestDocumentWithQRCodeRenders(t *testing.T) {
	d, err := newDoc(false)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.text(margin, "E-Ticket · Pelayaran Senja · Ž", 12, true, ink); err != nil {
		t.Fatal(err)
	}
	img, err := qrImage("https://example.test/verify/abc", 300)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.pdf.ImageFrom(img, margin, 80, &rect{W: 120, H: 120}); err != nil {
		t.Fatalf("embed qr: %v", err)
	}
	out, err := d.bytes()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF")) {
		t.Fatal("not a PDF")
	}
}
