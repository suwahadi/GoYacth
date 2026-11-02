import { Container } from "~/components/ui";
import { HomeSectionView } from "~/features/public/content";
import { useT } from "~/lib/i18n";
import type { HomeSection } from "~/lib/types";

import { CtaBand } from "./cta-band";
import { DestinationsBand } from "./destinations";
import { FleetSection } from "./fleet";
import { HeroCarousel } from "./hero";
import { TrustStrip, WhySection } from "./highlights";
import { ReviewsSection } from "./reviews";
import { SearchBar } from "./search-bar";
import { splitHomeSections } from "./sections";

function Block({ section }: { section: HomeSection }) {
  switch (section.type) {
    case "HIGHLIGHTS":
      return section.image ? <WhySection section={section} /> : <TrustStrip section={section} />;
    case "FEATURED_BOATS":
      return <FleetSection section={section} />;
    case "REGIONS":
      return <DestinationsBand section={section} />;
    case "REVIEWS":
      return <ReviewsSection section={section} />;
    case "CTA":
      return <CtaBand section={section} />;
    default:
      return (
        <Container className="pb-8">
          <HomeSectionView section={section} />
        </Container>
      );
  }
}

export function HomePage({ sections }: { sections: HomeSection[] }) {
  const t = useT();
  const { slides, rest, regions } = splitHomeSections(sections);
  return (
    <>
      {slides.length > 0 ? <HeroCarousel slides={slides} /> : <h1 className="sr-only">{t("public.home.title")}</h1>}
      <SearchBar regions={regions} overlapsHero={slides.length > 0} />
      {rest.map((s) => (
        <Block key={s.id} section={s} />
      ))}
    </>
  );
}
