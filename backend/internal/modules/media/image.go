package media

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"

	"github.com/davidbyttow/govips/v2/vips"
	_ "golang.org/x/image/webp"
)

const (
	MaxUploadBytes = 15 << 20
	MaxPixels      = 50_000_000
	MaxSide        = 12_000
)

var VariantWidths = []int{400, 800, 1600}

var (
	ErrUnsupportedType = errors.New("unsupported image type")
	ErrTooLarge        = errors.New("image dimensions too large")
	ErrCorrupt         = errors.New("image could not be decoded")
)

var allowedTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// Inspect checks the real content type from magic bytes and reads only the header to get the
// dimensions, so decompression bombs are rejected before any full decode happens.
func Inspect(data []byte) (contentType string, width, height int, err error) {
	contentType = http.DetectContentType(data)
	if !allowedTypes[contentType] {
		return "", 0, 0, ErrUnsupportedType
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", 0, 0, ErrCorrupt
	}
	if "image/"+format != contentType {
		return "", 0, 0, ErrUnsupportedType
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > MaxSide || cfg.Height > MaxSide || cfg.Width*cfg.Height > MaxPixels {
		return "", 0, 0, ErrTooLarge
	}
	return contentType, cfg.Width, cfg.Height, nil
}

type Variant struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Key    string `json:"key"`
	Bytes  int    `json:"bytes"`
}

type encoded struct {
	Variant
	data []byte
}

// Convert fully decodes the image, applies EXIF orientation, strips metadata and produces WebP
// variants without upscaling. If the source is narrower than the smallest variant, a single
// variant at the original width is produced so every image has at least one rendition.
func Convert(data []byte, baseName string) (width, height int, out []encoded, err error) {
	src, err := vips.NewImageFromBuffer(data)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	defer src.Close()
	if err := src.AutoRotate(); err != nil {
		return 0, 0, nil, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	if err := src.RemoveMetadata(); err != nil {
		return 0, 0, nil, err
	}
	width, height = src.Width(), src.Height()
	if width*height > MaxPixels {
		return 0, 0, nil, ErrTooLarge
	}

	targets := make([]int, 0, len(VariantWidths))
	for _, w := range VariantWidths {
		if w <= width {
			targets = append(targets, w)
		}
	}
	if len(targets) == 0 {
		targets = []int{width}
	}
	for _, w := range targets {
		img, err := src.Copy()
		if err != nil {
			return 0, 0, nil, err
		}
		h := int(int64(height) * int64(w) / int64(width))
		if h < 1 {
			h = 1
		}
		if w != width {
			if err := img.Thumbnail(w, h, vips.InterestingNone); err != nil {
				img.Close()
				return 0, 0, nil, err
			}
		}
		params := vips.NewWebpExportParams()
		params.Quality = 75
		params.ReductionEffort = 6
		params.StripMetadata = true
		buf, _, err := img.ExportWebp(params)
		actualW, actualH := img.Width(), img.Height()
		img.Close()
		if err != nil {
			return 0, 0, nil, err
		}
		key := fmt.Sprintf("%s-%d.webp", baseName, actualW)
		out = append(out, encoded{Variant: Variant{Width: actualW, Height: actualH, Key: key, Bytes: len(buf)}, data: buf})
	}
	return width, height, out, nil
}
