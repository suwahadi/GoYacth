// Package db embeds the SQL migrations so the CLI binary can migrate without the source tree.
package db

import "embed"

//go:embed migrations/*.sql
var Migrations embed.FS
