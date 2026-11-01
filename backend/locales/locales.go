// Package locales embeds backend message catalogs (email, PDF) so binaries are self-contained.
package locales

import "embed"

//go:embed en id
var FS embed.FS
