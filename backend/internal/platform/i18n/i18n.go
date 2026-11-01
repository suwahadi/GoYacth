package i18n

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"strings"
)

// Supported lists the content locales. Adding a language means adding it here, adding a locale
// folder on the frontend and in backend/locales; no database migration is needed.
var Supported = []string{"en", "id"}

const Default = "en"

func Valid(locale string) bool { return slices.Contains(Supported, locale) }

func Normalize(locale string) string {
	locale = strings.ToLower(strings.TrimSpace(locale))
	if len(locale) > 2 {
		locale = locale[:2]
	}
	if Valid(locale) {
		return locale
	}
	return Default
}

// Messages holds flattened backend strings (email templates, PDF labels) per locale.
type Messages struct {
	byLocale map[string]map[string]string
}

func Load(fsys fs.FS, root string) (*Messages, error) {
	m := &Messages{byLocale: map[string]map[string]string{}}
	for _, loc := range Supported {
		flat := map[string]string{}
		entries, err := fs.ReadDir(fsys, path.Join(root, loc))
		if err != nil {
			return nil, fmt.Errorf("read locale %s: %w", loc, err)
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			raw, err := fs.ReadFile(fsys, path.Join(root, loc, e.Name()))
			if err != nil {
				return nil, err
			}
			var tree map[string]any
			if err := json.Unmarshal(raw, &tree); err != nil {
				return nil, fmt.Errorf("parse %s/%s: %w", loc, e.Name(), err)
			}
			flatten(strings.TrimSuffix(e.Name(), ".json"), tree, flat)
		}
		m.byLocale[loc] = flat
	}
	for key := range m.byLocale[Default] {
		for _, loc := range Supported {
			if _, ok := m.byLocale[loc][key]; !ok {
				return nil, fmt.Errorf("locale %s is missing key %s", loc, key)
			}
		}
	}
	return m, nil
}

func flatten(prefix string, tree map[string]any, out map[string]string) {
	for k, v := range tree {
		key := prefix + "." + k
		switch t := v.(type) {
		case string:
			out[key] = t
		case map[string]any:
			flatten(key, t, out)
		}
	}
}

var placeholder = regexp.MustCompile(`\{\{\s*(\w+)\s*\}\}`)

// T returns the message for key in locale, substituting {{name}} placeholders.
func (m *Messages) T(locale, key string, vars map[string]string) string {
	msg, ok := m.byLocale[Normalize(locale)][key]
	if !ok {
		msg, ok = m.byLocale[Default][key]
		if !ok {
			return key
		}
	}
	return placeholder.ReplaceAllStringFunc(msg, func(s string) string {
		name := placeholder.FindStringSubmatch(s)[1]
		if v, ok := vars[name]; ok {
			return v
		}
		return s
	})
}
