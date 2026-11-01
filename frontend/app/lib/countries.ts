// ISO 3166-1 alpha-2 codes. Display names come from Intl.DisplayNames in the active locale.
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

// Calling codes for the phone input; the list covers the countries guests most often come from
// and every code is editable, so less common countries can still be entered.
export const DIAL_CODES: { code: string; dial: string }[] = [
  { code: "ID", dial: "+62" }, { code: "AU", dial: "+61" }, { code: "SG", dial: "+65" }, { code: "MY", dial: "+60" },
  { code: "US", dial: "+1" }, { code: "GB", dial: "+44" }, { code: "DE", dial: "+49" }, { code: "FR", dial: "+33" },
  { code: "NL", dial: "+31" }, { code: "IT", dial: "+39" }, { code: "ES", dial: "+34" }, { code: "CH", dial: "+41" },
  { code: "CN", dial: "+86" }, { code: "JP", dial: "+81" }, { code: "KR", dial: "+82" }, { code: "IN", dial: "+91" },
  { code: "RU", dial: "+7" }, { code: "AE", dial: "+971" }, { code: "SA", dial: "+966" }, { code: "NZ", dial: "+64" },
  { code: "CA", dial: "+1" }, { code: "TH", dial: "+66" }, { code: "PH", dial: "+63" }, { code: "VN", dial: "+84" },
  { code: "HK", dial: "+852" }, { code: "TW", dial: "+886" }, { code: "BR", dial: "+55" }, { code: "SE", dial: "+46" },
  { code: "NO", dial: "+47" }, { code: "DK", dial: "+45" }, { code: "BE", dial: "+32" }, { code: "AT", dial: "+43" },
  { code: "PL", dial: "+48" }, { code: "IL", dial: "+972" }, { code: "ZA", dial: "+27" }, { code: "TL", dial: "+670" },
];
