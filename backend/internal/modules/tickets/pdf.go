package tickets

import (
	_ "embed"
	"fmt"
	"image"
	"image/draw"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/qr"
	"github.com/signintech/gopdf"
)

//go:embed fonts/NotoSans-Regular.ttf
var fontRegular []byte

//go:embed fonts/NotoSans-Bold.ttf
var fontBold []byte

const margin = 40.0

// doc wraps gopdf with the few layout helpers the ticket, invoice and manifest share. Everything
// is drawn in code with an embedded Unicode font; no browser is involved.
type doc struct {
	pdf  *gopdf.GoPdf
	y    float64
	w, h float64
}

func newDoc(landscape bool) (*doc, error) {
	p := &gopdf.GoPdf{}
	size := *gopdf.PageSizeA4
	if landscape {
		size = gopdf.Rect{W: size.H, H: size.W}
	}
	p.Start(gopdf.Config{PageSize: size})
	if err := p.AddTTFFontData("sans", fontRegular); err != nil {
		return nil, err
	}
	if err := p.AddTTFFontData("sans-bold", fontBold); err != nil {
		return nil, err
	}
	p.AddPage()
	return &doc{pdf: p, y: margin, w: size.W, h: size.H}, nil
}

func (d *doc) width() float64 { return d.w }

func (d *doc) height() float64 { return d.h }

func (d *doc) ensure(space float64) {
	if d.y+space > d.height()-margin {
		d.pdf.AddPage()
		d.y = margin
	}
}

func (d *doc) text(x float64, s string, size float64, bold bool, color [3]uint8) error {
	font := "sans"
	if bold {
		font = "sans-bold"
	}
	if err := d.pdf.SetFont(font, "", size); err != nil {
		return err
	}
	d.pdf.SetTextColor(color[0], color[1], color[2])
	d.pdf.SetXY(x, d.y)
	return d.pdf.Cell(nil, s)
}

func (d *doc) textRight(rightX float64, s string, size float64, bold bool) error {
	font := "sans"
	if bold {
		font = "sans-bold"
	}
	if err := d.pdf.SetFont(font, "", size); err != nil {
		return err
	}
	w, err := d.pdf.MeasureTextWidth(s)
	if err != nil {
		return err
	}
	d.pdf.SetTextColor(31, 41, 51)
	d.pdf.SetXY(rightX-w, d.y)
	return d.pdf.Cell(nil, s)
}

func (d *doc) wrapped(x, w float64, s string, size float64) error {
	if err := d.pdf.SetFont("sans", "", size); err != nil {
		return err
	}
	d.pdf.SetTextColor(31, 41, 51)
	lines, err := d.pdf.SplitText(s, w)
	if err != nil {
		return err
	}
	for _, l := range lines {
		d.ensure(size + 4)
		d.pdf.SetXY(x, d.y)
		if err := d.pdf.Cell(nil, l); err != nil {
			return err
		}
		d.y += size + 4
	}
	return nil
}

func (d *doc) rule() {
	d.pdf.SetStrokeColor(228, 231, 235)
	d.pdf.SetLineWidth(0.8)
	d.pdf.Line(margin, d.y, d.width()-margin, d.y)
}

var (
	ink   = [3]uint8{31, 41, 51}
	muted = [3]uint8{82, 96, 109}
	brand = [3]uint8{11, 79, 108}
)

func (d *doc) kv(label, value string) error {
	d.ensure(18)
	if err := d.text(margin, label, 10, false, muted); err != nil {
		return err
	}
	if err := d.text(margin+150, value, 10, true, ink); err != nil {
		return err
	}
	d.y += 18
	return nil
}

func qrImage(content string, size int) (image.Image, error) {
	code, err := qr.Encode(content, qr.M, qr.Auto)
	if err != nil {
		return nil, fmt.Errorf("encode qr: %w", err)
	}
	scaled, err := barcode.Scale(code, size, size)
	if err != nil {
		return nil, err
	}
	// gopdf only embeds 8-bit images; the QR encoder produces 16-bit grayscale.
	rgba := image.NewRGBA(scaled.Bounds())
	draw.Draw(rgba, rgba.Bounds(), scaled, scaled.Bounds().Min, draw.Src)
	return rgba, nil
}

func (d *doc) bytes() ([]byte, error) { return d.pdf.GetBytesPdfReturnErr() }
