package validate

import (
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"
)

var e164 = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)

func Phone(s string) bool { return e164.MatchString(s) }

func Email(s string) bool {
	if len(s) > 254 {
		return false
	}
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s
}

func Length(s string, min, max int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	return n >= min && n <= max
}

var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func Slug(s string) bool { return len(s) >= 1 && len(s) <= 120 && slugRe.MatchString(s) }

// ISO 3166-1 alpha-2 officially assigned codes.
const isoCountries = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
	"CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
	"GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
	"KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
	"NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
	"SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
	"UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"

var countries = func() map[string]bool {
	m := map[string]bool{}
	for _, c := range strings.Fields(isoCountries) {
		m[c] = true
	}
	return m
}()

func Country(code string) bool { return countries[code] }

const (
	IDTypeKTP      = "KTP"
	IDTypeSIM      = "SIM"
	IDTypePassport = "PASSPORT"
	IDTypeKITAS    = "KITAS"
)

var (
	ktpRe      = regexp.MustCompile(`^[0-9]{16}$`)
	simRe      = regexp.MustCompile(`^[0-9]{8,20}$`)
	passportRe = regexp.MustCompile(`^[A-Z0-9]{5,20}$`)
	kitasRe    = regexp.MustCompile(`^[A-Z0-9]{5,30}$`)
)

// NormalizeIDNumber strips spaces and dashes and upper-cases the value before validation and
// encryption, so the same document always produces the same stored value.
func NormalizeIDNumber(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	return strings.NewReplacer(" ", "", "-", "", ".", "").Replace(s)
}

// Identity applies PRD section 8.2: KTP for Indonesians only, KITAS/KITAP for foreigners only,
// SIM for Indonesians, passports for everyone. It returns the field error code or "".
func Identity(idType, nationality, number string) (field, code string) {
	switch idType {
	case IDTypeKTP:
		if nationality != "ID" {
			return "id_type", "ID_TYPE_NOT_ALLOWED"
		}
		if !ktpRe.MatchString(number) {
			return "id_number", "INVALID_KTP"
		}
	case IDTypeSIM:
		if nationality != "ID" {
			return "id_type", "ID_TYPE_NOT_ALLOWED"
		}
		if !simRe.MatchString(number) {
			return "id_number", "INVALID_SIM"
		}
	case IDTypePassport:
		if !passportRe.MatchString(number) {
			return "id_number", "INVALID_PASSPORT"
		}
	case IDTypeKITAS:
		if nationality == "ID" {
			return "id_type", "ID_TYPE_NOT_ALLOWED"
		}
		if !kitasRe.MatchString(number) {
			return "id_number", "INVALID_KITAS"
		}
	default:
		return "id_type", "INVALID"
	}
	return "", ""
}
