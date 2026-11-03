package seed

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/modules/cms"
	"goyacht/internal/modules/departures"
	"goyacht/internal/platform/secure"
)

var demoPackages = []struct {
	slug, route, boat, photo string
	minutes, minPax, maxPax  int
	price                    int64
	name, summary            text
	description              text
	inclusions, exclusions   []text
}{
	{"honeymoon-sunset-escape", "benoa-sunset-cruise", "Sunset Voyager", "moment-couple", 180, 2, 4, 14_500_000,
		text{"Honeymoon Sunset Escape", "Honeymoon Sunset Escape"}, text{"A private three-hour sunset cruise for two.", "Pesiar senja privat tiga jam untuk berdua."},
		text{"Your own yacht from Benoa, a canape platter and time on deck as the sun drops behind Uluwatu.", "Yacht pribadi dari Benoa, sajian canape, dan waktu di dek saat matahari turun di balik Uluwatu."},
		[]text{{"Private yacht and crew", "Yacht pribadi dan awak"}, {"Canapes and soft drinks", "Canape dan minuman ringan"}, {"Harbour fees", "Biaya pelabuhan"}},
		[]text{{"Alcoholic drinks", "Minuman beralkohol"}, {"Hotel transfers", "Antar jemput hotel"}}},
	{"nusa-penida-family-day", "nusa-penida-day-trip", "Blue Lagoon One", "catamaran-turquoise", 480, 6, 20, 31_000_000,
		text{"Nusa Penida Family Day", "Hari Keluarga Nusa Penida"}, text{"A full day on a stable catamaran with snorkeling and lunch.", "Sehari penuh di katamaran stabil dengan snorkeling dan makan siang."},
		text{"Wide decks for children, calm snorkeling at Crystal Bay and lunch on board.", "Dek lebar untuk anak-anak, snorkeling tenang di Crystal Bay, dan makan siang di kapal."},
		[]text{{"Private catamaran and crew", "Katamaran pribadi dan awak"}, {"Lunch and water", "Makan siang dan air minum"}, {"Snorkeling gear", "Peralatan snorkeling"}},
		[]text{{"Park entry fees", "Tiket masuk kawasan"}, {"Hotel transfers", "Antar jemput hotel"}}},
	{"komodo-private-explorer", "komodo-highlights", "Padar Explorer", "phinisi-red-sails", 600, 4, 12, 76_000_000,
		text{"Komodo Private Explorer", "Komodo Private Explorer"}, text{"Padar, Pink Beach and the dragons on your own phinisi.", "Padar, Pantai Pink, dan komodo dengan phinisi pribadi."},
		text{"A long day through the national park with a guide, on a phinisi reserved for your group.", "Sehari panjang di taman nasional bersama pemandu, dengan phinisi khusus rombongan Anda."},
		[]text{{"Private phinisi and crew", "Phinisi pribadi dan awak"}, {"Licensed guide", "Pemandu berlisensi"}, {"All meals on board", "Semua makan di kapal"}},
		[]text{{"National park fees", "Biaya taman nasional"}, {"Flights to Labuan Bajo", "Penerbangan ke Labuan Bajo"}}},
	{"gili-island-hopper", "three-gilis-loop", "Trawangan Flyer", "place-gili", 360, 2, 8, 11_000_000,
		text{"Gili Island Hopper", "Gili Island Hopper"}, text{"All three Gilis in six hours by speedboat.", "Ketiga Gili dalam enam jam dengan speedboat."},
		text{"Turtle snorkeling off Trawangan, lunch on Meno and a last swim at Gili Air.", "Snorkeling bersama penyu di Trawangan, makan siang di Meno, dan berenang di Gili Air."},
		[]text{{"Private speedboat and crew", "Speedboat pribadi dan awak"}, {"Snorkeling gear", "Peralatan snorkeling"}, {"Water and fruit", "Air minum dan buah"}},
		[]text{{"Lunch", "Makan siang"}, {"Hotel transfers", "Antar jemput hotel"}}},
}

var demoDepartures = []struct {
	boat, route, departs, returns string
	inDays, nights                int
	seatPrice, privatePrice       int64
}{
	{"Komodo Dream", "komodo-highlights", "06:30", "16:30", 7, 0, 2_950_000, 14_500_000},
	{"Padar Explorer", "komodo-highlights", "07:00", "17:00", 10, 0, 1_850_000, 9_500_000},
	{"Flores Wind", "kelor-rinca-day-sail", "08:00", "16:00", 12, 0, 1_250_000, 6_500_000},
	{"Sea Dragon", "komodo-highlights", "06:30", "16:30", 15, 0, 2_350_000, 11_500_000},
	{"Blue Lagoon One", "nusa-penida-day-trip", "08:00", "16:00", 9, 0, 950_000, 4_800_000},
	{"Blue Lagoon One", "benoa-sunset-cruise", "16:00", "19:00", 16, 0, 650_000, 3_200_000},
	{"Island Breeze", "nusa-lembongan-escape", "09:00", "15:00", 11, 0, 750_000, 3_600_000},
	{"Sekotong Pearl", "three-gilis-loop", "09:00", "15:00", 13, 0, 850_000, 4_200_000},
	{"Raja Laut", "raja-ampat-voyage", "08:00", "08:00", 21, 3, 14_500_000, 62_000_000},
	{"Dampier Cat", "raja-ampat-voyage", "08:00", "08:00", 28, 3, 8_900_000, 38_000_000},
	{"Komodo Dream", "kelor-rinca-day-sail", "08:00", "16:00", 22, 0, 2_450_000, 12_000_000},
	{"Golden Horizon", "benoa-sunset-cruise", "16:00", "19:00", 18, 0, 1_450_000, 8_500_000},
}

func specOf(name string) demoBoat {
	for _, b := range demoBoats {
		if b.name == name {
			return b
		}
	}
	panic("unknown demo boat " + name)
}

func (s *seeder) departures() {
	for _, d := range demoDepartures {
		if s.err != nil {
			return
		}
		seeded, spec := s.boats[d.boat], specOf(d.boat)
		day := s.now.AddDate(0, 0, d.inDays)
		capacity := int32(spec.pax)
		slots := []departures.SlotInput{{SlotType: "SEAT_POOL", AreaIDs: seeded.areas, Price: d.seatPrice, SeatCapacity: &capacity, MinPax: 1, MaxPax: min(capacity, 8)}}
		if sold := spec.soldAreas(); len(sold) > 0 {
			pool := int32(spec.pax - sold[0].maxPax)
			slots = []departures.SlotInput{
				{SlotType: "SEAT_POOL", AreaIDs: seeded.areas[1:], Price: d.seatPrice, SeatCapacity: &pool, MinPax: 1, MaxPax: min(pool, 8)},
				{SlotType: "PRIVATE_AREA", AreaIDs: seeded.areas[:1], Price: d.privatePrice, MinPax: 2, MaxPax: int32(sold[0].maxPax)},
			}
		}
		_, s.err = departures.Create(s.ctx, s.tx, departures.CreateInput{
			BoatID: seeded.id, RouteID: s.routes[d.route], CloseHoursBefore: 24, Slots: slots,
			DepartsDate: day.Format(time.DateOnly), DepartsTime: d.departs,
			ReturnsDate: day.AddDate(0, 0, d.nights).Format(time.DateOnly), ReturnsTime: d.returns,
		}, nil, s.now)
		if s.err != nil {
			s.err = fmt.Errorf("departure %s %s: %w", d.boat, d.route, s.err)
		}
	}
}

// Invented guests for the development database only: Demo refuses to run in production, so these
// never appear as real reviews.
type demoReview struct {
	name, country, locale, boat, route string
	pax, daysAgo                       int
	overall, boatScore, service, crew  int
	title, body                        string
}

var demoReviews = []demoReview{
	{"Sophie Laurent", "FR", "en", "Ocean Majesty", "benoa-sunset-cruise", 6, 32, 5, 5, 5, 5, "A perfect evening off Uluwatu",
		"An incredible experience! The yacht was perfect, and the crew made our trip unforgettable."},
	{"Daniel Hartmann", "DE", "en", "Komodo Dream", "komodo-highlights", 8, 48, 5, 5, 5, 4, "Best day of our Indonesia trip",
		"We hiked Padar at sunrise and were snorkeling at Pink Beach before lunch. The phinisi felt like a floating hotel."},
	{"Emily Carter", "AU", "en", "Blue Lagoon One", "nusa-penida-day-trip", 12, 61, 5, 4, 5, 5, "Easy day out with the kids",
		"The catamaran stayed steady the whole way, and the crew kept an eye on our children in the water. Lunch was generous too."},
	{"Kenji Watanabe", "JP", "en", "Raja Laut", "raja-ampat-voyage", 10, 75, 5, 5, 5, 5, "Three days I will not forget",
		"Every morning we woke up somewhere new. The guides knew exactly where the mantas were, and the cabins were spotless."},
	{"Rina Kusuma", "ID", "id", "Gili Spirit", "three-gilis-loop", 8, 90, 5, 5, 4, 5, "Liburan keluarga yang menyenangkan",
		"Kapalnya bersih dan nyaman, awaknya ramah sekali. Anak-anak senang bisa berenang bersama penyu di Gili Trawangan."},
	{"Marco Bellini", "IT", "en", "Sunset Voyager", "benoa-sunset-cruise", 2, 104, 5, 5, 5, 5, "She said yes on deck",
		"I proposed at sunset and the crew helped me plan every detail in secret. We could not have asked for more."},
	{"Ayu Prameswari", "ID", "id", "Padar Explorer", "kelor-rinca-day-sail", 12, 118, 4, 4, 5, 5, "Pengalaman Komodo yang berkesan",
		"Rutenya pas untuk satu hari dan pemandunya sabar menjelaskan soal komodo. Makanan di kapal juga enak."},
	{"James O'Connor", "IE", "en", "Penida Express", "nusa-lembongan-escape", 8, 133, 5, 4, 5, 5, "Fast, friendly and on time",
		"Picked up right on schedule and straight out to Lembongan. The skipper found us a quiet reef away from the crowds."},
}

func (s *seeder) testimonials() {
	for i, r := range demoReviews {
		s.review(r, s.guest(i+1, r.name, r.country, r.locale), guestEmail(i+1), true)
	}
}

func (s *seeder) review(r demoReview, user uuid.UUID, email string, featured bool) {
	spec := specOf(r.boat)
	starts := s.now.AddDate(0, 0, -r.daysAgo).Truncate(24 * time.Hour).Add(time.Hour)
	total := max(spec.daily, spec.fixed)
	snapshot := map[string]any{
		"boat_name":  map[string]string{"en": r.boat, "id": r.boat},
		"route_name": map[string]string{"en": routeOf(r.route).name.en, "id": routeOf(r.route).name.id},
		"port_name":  map[string]string{"en": portOf(spec.port).name, "id": portOf(spec.port).name},
		"commission": map[string]any{"ownership": "OWNED", "value": 0, "amount": 0},
	}
	number := secure.BookingNumber()
	booking := s.insert(`INSERT INTO bookings (booking_number, user_id, mode, boat_id, route_id, starts_at, ends_at, timezone, pax, status, payment_status,
			payment_scheme, subtotal, grand_total, amount_paid, snapshot, consents, lead_full_name, lead_email, lead_phone, lead_nationality, locale, verify_token, created_at)
		VALUES ($1, $2, 'PRIVATE_CHARTER', $3, $4, $5, $6, $7, $8, 'COMPLETED', 'PAID', 'FULL', $9, $9, $9, $10::jsonb, '{}'::jsonb, $11, $12, '+620000000000', $13, $14, $15, $16) RETURNING id`,
		number, user, s.boats[r.boat].id, s.routes[r.route], starts, starts.Add(time.Duration(routeOf(r.route).minutes)*time.Minute), portOf(spec.port).timezone,
		r.pax, total, mustJSON(snapshot), r.name, email, r.country, r.locale, secure.RandomToken(16), starts.AddDate(0, 0, -14))
	s.exec(`INSERT INTO payments (booking_id, kind, provider, method, order_id, principal_amount, gross_amount, status, paid_at, manual_paid_on, notes)
		VALUES ($1, 'FULL', 'MANUAL', 'BANK_TRANSFER', $2, $3, $3, 'SUCCEEDED', $4::timestamptz, ($4::timestamptz)::date, 'Demo payment')`, booking, "DEMO-"+number, total, starts.AddDate(0, 0, -14))
	s.exec(`INSERT INTO reviews (booking_id, user_id, boat_id, rating_overall, rating_boat, rating_service, rating_crew, title, body, locale, status, is_featured, moderated_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PUBLISHED', $12, $11, $11)`,
		booking, user, s.boats[r.boat].id, r.overall, r.boatScore, r.service, r.crew, r.title, r.body, r.locale, starts.AddDate(0, 0, 2), featured)
}

func routeOf(slug string) (r struct {
	name    text
	minutes int
}) {
	for _, x := range demoRoutes {
		if x.slug == slug {
			r.name, r.minutes = x.name, x.minutes
			return r
		}
	}
	panic("unknown demo route " + slug)
}

func (s *seeder) section(kind string, sort int, cfg cms.SectionConfig, photo string, en, id cms.SectionContent) {
	if photo != "" {
		mediaID := s.photos[photo]
		cfg.MediaID = &mediaID
	}
	section := s.insert(`INSERT INTO page_sections (type, sort_order, config) VALUES ($1, $2, $3::jsonb) RETURNING id`, kind, sort, mustJSON(cfg))
	for _, t := range []struct {
		locale  string
		content cms.SectionContent
	}{{"en", en}, {"id", id}} {
		s.exec(`INSERT INTO page_section_translations (section_id, locale, content) VALUES ($1, $2, $3::jsonb)`, section, t.locale, mustJSON(t.content))
	}
	if photo != "" {
		s.attach(cms.EntitySection, section, "image", photo)
	}
}

func (s *seeder) homepage() {
	s.section("HERO", 1, cms.SectionConfig{}, "yacht-dusk",
		cms.SectionContent{Title: "Discover the\nBeauty of Indonesia", Subtitle: "Premium Yacht Charter", Body: "Charter a luxury yacht or join our curated departures for an unforgettable journey across Indonesia's most stunning destinations.", CTALabel: "Explore Our Fleet", CTAURL: "/boats"},
		cms.SectionContent{Title: "Temukan Keindahan Indonesia", Subtitle: "Sewa Yacht Premium", Body: "Sewa yacht mewah atau ikut jadwal keberangkatan pilihan kami untuk perjalanan tak terlupakan ke destinasi terindah di Indonesia.", CTALabel: "Lihat Armada Kami", CTAURL: "/boats"})
	s.section("HERO", 2, cms.SectionConfig{}, "place-piaynemo",
		cms.SectionContent{Title: "Sail Between Indonesia's Islands", Subtitle: "Destinations", Body: "Bali, Lombok, Labuan Bajo and Raja Ampat, each with departures from its own home port.", CTALabel: "View Destinations", CTAURL: "/destinations"},
		cms.SectionContent{Title: "Berlayar di Antara Pulau-Pulau Indonesia", Subtitle: "Destinasi", Body: "Bali, Lombok, Labuan Bajo, dan Raja Ampat, masing-masing berangkat dari pelabuhannya sendiri.", CTALabel: "Lihat Destinasi", CTAURL: "/destinations"})
	s.section("HERO", 3, cms.SectionConfig{}, "catamaran-sunset",
		cms.SectionContent{Title: "Sunset Hours on Your Own Deck", Subtitle: "Private Charter", Body: "Book the whole boat for your group, then choose your route, date and time on the water.", CTALabel: "Plan a Private Charter", CTAURL: "/boats"},
		cms.SectionContent{Title: "Senja di Dek Kapal Anda Sendiri", Subtitle: "Private Charter", Body: "Sewa seluruh kapal untuk rombongan Anda, lalu pilih rute, tanggal, dan waktu berlayar.", CTALabel: "Rencanakan Private Charter", CTAURL: "/boats"})
	s.section("HIGHLIGHTS", 4, cms.SectionConfig{}, "",
		cms.SectionContent{Items: []cms.SectionItem{{Title: "Luxury Fleet", Text: "Premium Selection", Icon: "diamond"}, {Title: "Trusted & Safe", Text: "Your Safety First", Icon: "shield"}, {Title: "24/7 Support", Text: "Always Here", Icon: "headset"}, {Title: "Unforgettable Experience", Text: "Beyond Expectations", Icon: "star"}}},
		cms.SectionContent{Items: []cms.SectionItem{{Title: "Armada Mewah", Text: "Pilihan Premium", Icon: "diamond"}, {Title: "Tepercaya & Aman", Text: "Keselamatan Anda yang Utama", Icon: "shield"}, {Title: "Dukungan 24/7", Text: "Selalu Siap Membantu", Icon: "headset"}, {Title: "Pengalaman Tak Terlupakan", Text: "Melebihi Harapan", Icon: "star"}}})
	s.section("FEATURED_BOATS", 5, cms.SectionConfig{BoatIDs: []uuid.UUID{s.boats["Ocean Majesty"].id, s.boats["Blue Lagoon One"].id, s.boats["Komodo Dream"].id}, Limit: 3}, "",
		cms.SectionContent{Title: "Exceptional Yachts", Subtitle: "Our Fleet", Body: "From elegant yachts to spacious catamarans, explore our handpicked fleet.", CTALabel: "View All Fleet", CTAURL: "/boats"},
		cms.SectionContent{Title: "Yacht Istimewa", Subtitle: "Armada Kami", Body: "Dari yacht elegan hingga katamaran yang lapang, jelajahi armada pilihan kami.", CTALabel: "Lihat Semua Armada", CTAURL: "/boats"})
	s.section("REGIONS", 6, cms.SectionConfig{}, "place-wayag",
		cms.SectionContent{Title: "Paradise Awaits", Subtitle: "Explore Destinations", Body: "Sail to breathtaking destinations from Bali to Labuan Bajo and beyond.", CTALabel: "Explore Destinations", CTAURL: "/destinations"},
		cms.SectionContent{Title: "Surga Menanti", Subtitle: "Jelajahi Destinasi", Body: "Berlayar ke destinasi memukau, dari Bali hingga Labuan Bajo dan sekitarnya.", CTALabel: "Jelajahi Destinasi", CTAURL: "/destinations"})
	s.section("HIGHLIGHTS", 7, cms.SectionConfig{}, "moment-bow",
		cms.SectionContent{Title: "Unforgettable Moments", Subtitle: "Why Choose Us", Body: "More than a journey, a memorable experience.", Items: []cms.SectionItem{{Title: "World-Class Fleet", Icon: "globe"}, {Title: "Safe & Reliable", Icon: "shield"}, {Title: "Dedicated Support", Icon: "headset"}, {Title: "Tailored Packages", Icon: "star"}}},
		cms.SectionContent{Title: "Momen Tak Terlupakan", Subtitle: "Mengapa Memilih Kami", Body: "Lebih dari sekadar perjalanan, ini pengalaman yang berkesan.", Items: []cms.SectionItem{{Title: "Armada Kelas Dunia", Icon: "globe"}, {Title: "Aman & Andal", Icon: "shield"}, {Title: "Dukungan Khusus", Icon: "headset"}, {Title: "Paket Sesuai Keinginan", Icon: "star"}}})
	s.section("REVIEWS", 8, cms.SectionConfig{Limit: int32(len(demoReviews))}, "",
		cms.SectionContent{Title: "What Our Guests Say"}, cms.SectionContent{Title: "Kata Tamu Kami"})
	s.section("CTA", 9, cms.SectionConfig{}, "",
		cms.SectionContent{Title: "Ready for Your Next Adventure?", Body: "Book your yacht today and experience the best of Indonesia.", CTALabel: "Book Your Journey", CTAURL: "/boats"},
		cms.SectionContent{Title: "Siap untuk Petualangan Berikutnya?", Body: "Pesan yacht Anda hari ini dan nikmati yang terbaik dari Indonesia.", CTALabel: "Pesan Perjalanan", CTAURL: "/boats"})
}

type pageBlock struct {
	kind, url string
	level     int
	content   text
	items     []text
}

func heading(t text) pageBlock   { return pageBlock{kind: "heading", level: 2, content: t} }
func paragraph(t text) pageBlock { return pageBlock{kind: "paragraph", content: t} }
func quote(t text) pageBlock     { return pageBlock{kind: "quote", content: t} }
func list(items ...text) pageBlock {
	return pageBlock{kind: "list", items: items}
}
func cta(label text, url string) pageBlock {
	return pageBlock{kind: "cta", content: label, url: url}
}

func (b pageBlock) render(locale string) cms.Block {
	out := cms.Block{Type: b.kind, Level: b.level}
	switch b.kind {
	case "list":
		out.Items = localized(b.items, locale)
	case "cta":
		out.Label, out.URL = b.content.get(locale), b.url
	default:
		out.Text = b.content.get(locale)
	}
	return out
}

type demoPage struct {
	slug, photo        string
	title, description text
	blocks             []pageBlock
}

var sampleLegalNotice = quote(text{
	"Sample text for demonstration. Have your legal counsel review and replace it before launch.",
	"Teks contoh untuk demonstrasi. Minta konsultan hukum meninjau dan menggantinya sebelum peluncuran.",
})

func demoPages() []demoPage {
	return []demoPage{
		{"about", "yacht-hills", text{"About GoYacht", "Tentang GoYacht"}, text{"Who we are and how we run yacht charters across Indonesia.", "Siapa kami dan cara kami menjalankan sewa yacht di Indonesia."}, []pageBlock{
			paragraph(text{"GoYacht is a single operator running its own fleet and selected partner boats in Bali, Lombok, Labuan Bajo and Raja Ampat.", "GoYacht adalah satu operator yang mengelola armada sendiri dan kapal mitra pilihan di Bali, Lombok, Labuan Bajo, dan Raja Ampat."}),
			heading(text{"Two ways to sail", "Dua cara berlayar"}),
			list(text{"Private charter: the whole boat for your group, on the route and date you choose.", "Private charter: seluruh kapal untuk rombongan Anda, dengan rute dan tanggal pilihan Anda."}, text{"Departures: a scheduled trip where you book seats or a private area on board.", "Keberangkatan: perjalanan terjadwal dengan pilihan kursi atau area privat di kapal."}),
			heading(text{"Clear prices", "Harga yang jelas"}),
			paragraph(text{"Every price is calculated in rupiah before you pay, with taxes, service and payment fees shown line by line.", "Setiap harga dihitung dalam rupiah sebelum Anda membayar, dengan pajak, layanan, dan biaya pembayaran ditampilkan per baris."}),
			cta(text{"See the fleet", "Lihat armada"}, "/boats"),
		}},
		{"contact", "deck-lounge", text{"Contact Us", "Hubungi Kami"}, text{"How to reach the GoYacht team.", "Cara menghubungi tim GoYacht."}, []pageBlock{
			paragraph(text{"Talk to us about a charter, a change to your booking or a custom route.", "Hubungi kami soal charter, perubahan booking, atau rute khusus."}),
			list(text{"Email: hello@goyacht.example", "Email: hello@goyacht.example"}, text{"Phone: +62 361 555 0100", "Telepon: +62 361 555 0100"}, text{"WhatsApp: +62 812 0000 0000", "WhatsApp: +62 812 0000 0000"}, text{"Office: Jl. Pelabuhan Benoa, Denpasar, Bali", "Kantor: Jl. Pelabuhan Benoa, Denpasar, Bali"}),
			paragraph(text{"These contact details are demo data.", "Detail kontak ini adalah data demo."}),
			cta(text{"Track a booking", "Lacak booking"}, "/track"),
		}},
		{"how-to-book", "catamaran-deck", text{"How to Book", "Cara Memesan"}, text{"From choosing a boat to boarding day.", "Dari memilih kapal hingga hari keberangkatan."}, []pageBlock{
			list(text{"Choose a boat, a departure or a package.", "Pilih kapal, jadwal keberangkatan, atau paket."}, text{"Sign in with Google.", "Masuk dengan Google."}, text{"Enter your details and every guest's name.", "Isi data Anda dan nama setiap tamu."}, text{"Pick a payment method and pay in full or by deposit where available.", "Pilih metode bayar, lalu bayar lunas atau DP jika tersedia."}, text{"Download your ticket with its QR code.", "Unduh tiket Anda beserta kode QR-nya."}),
			paragraph(text{"Your slot is held for a short time while you pay. The hold ends automatically if payment is not completed.", "Slot Anda ditahan sebentar selama pembayaran. Penahanan berakhir otomatis bila pembayaran tidak selesai."}),
		}},
		{"terms", "", text{"Terms and Conditions", "Syarat dan Ketentuan"}, text{"Terms for booking with GoYacht.", "Ketentuan pemesanan di GoYacht."}, []pageBlock{
			sampleLegalNotice,
			heading(text{"Bookings", "Pemesanan"}),
			paragraph(text{"A booking is confirmed once the first payment is verified. The number of guests cannot be changed after checkout.", "Booking terkonfirmasi setelah pembayaran pertama terverifikasi. Jumlah tamu tidak dapat diubah setelah checkout."}),
			heading(text{"Payments", "Pembayaran"}),
			paragraph(text{"Prices are charged in Indonesian rupiah. If a deposit is paid and the balance is not settled by its deadline, the booking is cancelled and the deposit is forfeited.", "Harga ditagih dalam rupiah. Bila DP dibayar dan pelunasan tidak selesai sebelum tenggat, booking dibatalkan dan DP hangus."}),
			heading(text{"Safety", "Keselamatan"}),
			paragraph(text{"The captain may change or cancel a route for weather or safety. Trips cancelled by the operator are refunded in full.", "Kapten dapat mengubah atau membatalkan rute karena cuaca atau keselamatan. Perjalanan yang dibatalkan operator direfund penuh."}),
		}},
		{"privacy", "", text{"Privacy Policy", "Kebijakan Privasi"}, text{"How GoYacht handles your personal data.", "Cara GoYacht menangani data pribadi Anda."}, []pageBlock{
			sampleLegalNotice,
			heading(text{"What we collect", "Data yang kami kumpulkan"}),
			list(text{"Your name, email and phone number.", "Nama, email, dan nomor telepon Anda."}, text{"Guest names for the passenger manifest.", "Nama tamu untuk manifes penumpang."}, text{"An identity number for the lead guest.", "Nomor identitas pemesan."}),
			heading(text{"How we protect it", "Cara kami melindunginya"}),
			paragraph(text{"Identity numbers are encrypted and deleted automatically after your trip. They never appear in public tracking pages or emails.", "Nomor identitas dienkripsi dan dihapus otomatis setelah perjalanan. Nomor ini tidak pernah tampil di halaman pelacakan publik atau email."}),
			heading(text{"Your choices", "Pilihan Anda"}),
			paragraph(text{"You can ask us to delete your account. Personal data is anonymized, and financial records are kept as the law requires.", "Anda dapat meminta penghapusan akun. Data pribadi dianonimkan, dan catatan keuangan disimpan sesuai ketentuan."}),
		}},
		{"cancellation-policy", "", text{"Cancellation Policy", "Kebijakan Pembatalan"}, text{"Refund rules when a booking is cancelled.", "Aturan refund saat booking dibatalkan."}, []pageBlock{
			sampleLegalNotice,
			heading(text{"If you cancel", "Bila Anda membatalkan"}),
			list(text{"8 days or more before departure: 100% refund", "8 hari atau lebih sebelum keberangkatan: refund 100%"}, text{"3 to 7 days before departure: 50% refund", "3 sampai 7 hari sebelum keberangkatan: refund 50%"}, text{"Less than 3 days before departure: no refund", "Kurang dari 3 hari sebelum keberangkatan: tanpa refund"}),
			paragraph(text{"Refunds are based on the amount you paid, excluding payment method fees. The policy shown at checkout applies to your booking.", "Refund dihitung dari jumlah yang dibayar, di luar biaya metode bayar. Kebijakan yang tampil saat checkout berlaku untuk booking Anda."}),
			heading(text{"If we cancel", "Bila kami membatalkan"}),
			paragraph(text{"If we cancel for weather or operational reasons, you receive a full refund, including payment method fees.", "Bila kami membatalkan karena cuaca atau alasan operasional, Anda menerima refund penuh, termasuk biaya metode bayar."}),
		}},
	}
}

var demoFaqs = []struct {
	category         string
	question, answer text
}{
	{"BOOKING", text{"What is the difference between a private charter and a departure?", "Apa beda private charter dan keberangkatan?"}, text{"A private charter reserves the whole boat for your group. A departure is a scheduled trip where you book seats or a private area.", "Private charter memesan seluruh kapal untuk rombongan Anda. Keberangkatan adalah perjalanan terjadwal dengan pilihan kursi atau area privat."}},
	{"BOOKING", text{"How far in advance can I book?", "Seberapa jauh sebelumnya saya bisa memesan?"}, text{"You can book from 24 hours up to 12 months before departure.", "Anda bisa memesan mulai 24 jam hingga 12 bulan sebelum keberangkatan."}},
	{"BOOKING", text{"Can I change the number of guests after booking?", "Bisakah saya mengubah jumlah tamu setelah memesan?"}, text{"Not after checkout. To change the group size, cancel and book again, or contact us about a reschedule.", "Tidak setelah checkout. Untuk mengubah jumlah tamu, batalkan lalu pesan ulang, atau hubungi kami soal reschedule."}},
	{"BOOKING", text{"Do I need an account to book?", "Apakah saya perlu akun untuk memesan?"}, text{"You can browse without one. Checkout needs a Google sign-in so your booking and tickets stay in one place.", "Anda bisa melihat-lihat tanpa akun. Checkout memerlukan login Google agar booking dan tiket tersimpan di satu tempat."}},
	{"PAYMENT", text{"Which payment methods do you accept?", "Metode pembayaran apa yang diterima?"}, text{"Credit and debit cards, QRIS, and virtual accounts from BCA, BNI, BRI, Mandiri and Permata.", "Kartu kredit dan debit, QRIS, serta virtual account BCA, BNI, BRI, Mandiri, dan Permata."}},
	{"PAYMENT", text{"Can I pay a deposit?", "Bisakah saya membayar DP?"}, text{"Many boats accept a deposit, with the balance due before departure. The deadline appears at checkout and on your ticket.", "Banyak kapal menerima DP, dengan pelunasan sebelum keberangkatan. Tenggatnya tampil saat checkout dan di tiket Anda."}},
	{"PAYMENT", text{"What happens if I miss the balance deadline?", "Apa yang terjadi bila pelunasan terlambat?"}, text{"The booking is cancelled automatically and the deposit is forfeited. We send reminders 3 days and 1 day before the deadline.", "Booking dibatalkan otomatis dan DP hangus. Kami mengirim pengingat 3 hari dan 1 hari sebelum tenggat."}},
	{"TRIP", text{"What should I bring on board?", "Apa yang perlu dibawa ke kapal?"}, text{"Your ticket, a valid ID for the lead guest, swimwear, sunscreen and a light jacket for the evening.", "Tiket, identitas yang berlaku untuk pemesan, pakaian renang, tabir surya, dan jaket tipis untuk malam hari."}},
	{"TRIP", text{"What if the weather is bad?", "Bagaimana bila cuaca buruk?"}, text{"The captain decides whether it is safe to sail. If we cancel, you receive a full refund.", "Kapten memutuskan apakah aman untuk berlayar. Bila kami membatalkan, Anda menerima refund penuh."}},
	{"TRIP", text{"Which time zone are departure times in?", "Jam keberangkatan memakai zona waktu apa?"}, text{"Times follow the departure port, shown with its label: WITA for Bali, Lombok and Labuan Bajo, WIT for Raja Ampat.", "Jam mengikuti pelabuhan keberangkatan beserta labelnya: WITA untuk Bali, Lombok, dan Labuan Bajo, WIT untuk Raja Ampat."}},
}
