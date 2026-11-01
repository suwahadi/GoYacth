import type { Location } from "react-router";

import { splitLocale } from "~/lib/config";
import { translate, type TKey } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";

export function privateMeta(location: Location, titleKey: TKey) {
  return noindexMeta(translate(splitLocale(location.pathname).locale, titleKey));
}
