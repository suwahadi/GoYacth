package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

func TestMain(m *testing.M) {
	vips.LoggingSettings(nil, vips.LogLevelError)
	if err := vips.Startup(nil); err != nil {
		panic(err)
	}
	code := m.Run()
	vips.Shutdown()
	os.Exit(code)
}

func jpegOf(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, h/2, color.RGBA{200, 30, 30, 255})
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func TestConvertProducesWebPWithoutUpscaling(t *testing.T) {
	_, _, out, err := Convert(jpegOf(1000, 500), "boat-abc")
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || out[0].Width != 400 || out[1].Width != 800 || out[1].Height != 400 {
		t.Fatalf("unexpected variants %+v", out)
	}
	if string(out[0].data[8:12]) != "WEBP" || out[1].Key != "boat-abc-800.webp" {
		t.Fatalf("variant is not a webp: %q %s", out[0].data[:12], out[1].Key)
	}
	_, _, small, err := Convert(jpegOf(300, 200), "tiny")
	if err != nil || len(small) != 1 || small[0].Width != 300 {
		t.Fatalf("small image must keep its width: %+v %v", small, err)
	}
}

func TestInspectRejectsSpoofedType(t *testing.T) {
	if _, _, _, err := Inspect([]byte("GIF89a not really")); err != ErrUnsupportedType {
		t.Fatalf("expected unsupported type, got %v", err)
	}
	ct, w, h, err := Inspect(jpegOf(20, 10))
	if err != nil || ct != "image/jpeg" || w != 20 || h != 10 {
		t.Fatalf("inspect jpeg: %s %d %d %v", ct, w, h, err)
	}
}
