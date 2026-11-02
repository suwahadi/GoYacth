// Package templates embeds the email layouts so binaries are self-contained.
package templates

import "embed"

//go:embed email
var FS embed.FS
