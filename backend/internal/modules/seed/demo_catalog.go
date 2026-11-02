package seed

import (
	"fmt"

	"goyacht/internal/modules/media"
)

type demoPhoto struct {
	key, id string
	alt     text
}

// Each ID was reviewed by eye: Unsplash's own captions are often wrong.
var demoPhotos = []demoPhoto{
	{"yacht-flybridge", "1605281317010-fe5ffe798166", text{"White flybridge yacht cruising on deep blue water", "Yacht flybridge putih berlayar di perairan biru"}},
	{"yacht-super", "1569263979104-865ab7cd8d13", text{"Large white superyacht on a calm sea", "Superyacht putih besar di laut yang tenang"}},
	{"yacht-bay", "1781872324499-e51350ed640e", text{"White superyacht moored in a mountain bay", "Superyacht putih berlabuh di teluk bergunung"}},
	{"yacht-turquoise", "1762353853326-20cc0b74e952", text{"Motor yacht anchored in turquoise water", "Motor yacht berlabuh di perairan pirus"}},
	{"yacht-harbor", "1562281302-809108fd533c", text{"Luxury yacht in a harbor at dusk", "Yacht mewah di pelabuhan saat senja"}},
	{"yacht-forest", "1535024966840-e7424dc2635b", text{"Motor yacht passing a forested coast", "Motor yacht melintasi pesisir berhutan"}},
	{"yacht-aerial", "1518528057367-d8618b763ca0", text{"Aerial view of a yacht and its wake on a dark sea", "Pemandangan udara yacht dan jejak ombaknya di laut gelap"}},
	{"yacht-sport", "1763877506730-eaf4a402ea1f", text{"Sport yacht speeding across blue waves", "Sport yacht melaju di atas ombak biru"}},
	{"yacht-sport-2", "1763877320106-803a588a0e72", text{"White sport yacht leaving a wake", "Sport yacht putih meninggalkan jejak ombak"}},
	{"yacht-sunset", "1622219969983-45589eae5637", text{"Yacht docked in golden sunset light", "Yacht bersandar di bawah cahaya senja keemasan"}},
	{"yacht-dusk", "1574850802664-10ad30c3ed80", text{"Superyacht at a quay under a pink evening sky", "Superyacht di dermaga dengan langit senja merah muda"}},
	{"yacht-island", "1787080768869-f89e99d23bc7", text{"Motor yacht below a rocky island", "Motor yacht di bawah pulau berbatu"}},
	{"yacht-hills", "1567899378494-47b22a2ae96a", text{"White yacht on blue water beside green hills", "Yacht putih di air biru dekat perbukitan hijau"}},
	{"yacht-wake", "1604737637145-48cc31d160eb", text{"Yacht from above with a white wake", "Yacht dari atas dengan jejak ombak putih"}},
	{"yacht-top", "1528154291023-a6525fabe5b4", text{"White yacht from above on calm water", "Yacht putih dari atas di air tenang"}},
	{"deck-lounge", "1758351820497-16de5afb5117", text{"Tan leather lounge on a yacht aft deck", "Lounge kulit cokelat di dek belakang yacht"}},
	{"deck-sunbed", "1785695583677-bb6cf19e274e", text{"Sun pad and teak deck at the bow of a yacht", "Sun pad dan dek jati di haluan yacht"}},

	{"catamaran-turquoise", "1781901360575-c93c5104c8f2", text{"White catamaran on clear turquoise water", "Katamaran putih di air pirus jernih"}},
	{"catamaran-bay", "1780567497860-454f0bb61727", text{"Catamaran anchored in a rocky bay", "Katamaran berlabuh di teluk berbatu"}},
	{"catamaran-island", "1761653434271-aef6b35cb3c1", text{"Catamaran sailing near a green island", "Katamaran berlayar dekat pulau hijau"}},
	{"catamaran-white", "1581271164789-7c97932822d3", text{"White sailing catamaran under a pale sky", "Katamaran layar putih di bawah langit cerah"}},
	{"catamaran-sail", "1723037706467-18ba6d269666", text{"Catamaran motoring along a coast", "Katamaran melaju di sepanjang pesisir"}},
	{"catamaran-sunset", "1773593893090-27d17a880a07", text{"View from a catamaran deck toward the sunset", "Pemandangan dari dek katamaran ke arah matahari terbenam"}},
	{"catamaran-deck", "1773594559238-1f4bcf8672a8", text{"Foredeck of a catamaran heading to a rocky island", "Dek depan katamaran menuju pulau berbatu"}},

	{"sail-sunset", "1770273786039-974fac264caa", text{"Sailing yacht at sea in soft evening light", "Yacht layar di laut dengan cahaya sore"}},
	{"sail-schooner", "1758576122353-937c44be1e63", text{"Two-masted sailing yacht on the open sea", "Yacht layar dua tiang di laut lepas"}},
	{"sail-lagoon", "1786355268513-1b73487be658", text{"Sailing yacht in a turquoise lagoon", "Yacht layar di laguna pirus"}},
	{"sail-blue", "1540946485063-a40da27545f8", text{"Sailing yacht under full sail on blue water", "Yacht layar dengan layar terkembang di air biru"}},

	{"speed-wake", "1552160757-52790c6f4faf", text{"White motorboat leaving a large wake", "Speedboat putih meninggalkan jejak ombak besar"}},
	{"speed-green", "1786517899271-8d8443b07bcb", text{"Small speedboat on clear green water", "Speedboat kecil di air hijau jernih"}},
	{"speed-sunset", "1520255870062-bd79d3865de7", text{"Speedboat with guests at sunset", "Speedboat dengan tamu saat matahari terbenam"}},
	{"speed-islands", "1779772088643-33c556274ae7", text{"White boat crossing calm water near islands", "Kapal putih menyeberangi air tenang dekat pulau"}},
	{"speed-turn", "1778165199402-cda4f24c1f0f", text{"Speedboat making a sharp turn", "Speedboat berbelok tajam"}},
	{"speed-cruiser", "1568476612160-787b6a1d5fb1", text{"White cruiser on deep blue water", "Kapal cruiser putih di perairan biru tua"}},
	{"speed-bow", "1622082671151-2cbd184f9e60", text{"Motor cruiser coming toward the camera", "Kapal motor melaju ke arah kamera"}},
	{"speed-bronze", "1534619039567-4db91b8d7e31", text{"Sleek bronze sport boat at anchor", "Sport boat perunggu berlabuh"}},
	{"speed-red", "1615646194267-ecf4380ac001", text{"Red and white race boat at speed", "Kapal balap merah putih sedang melaju"}},
	{"speed-crimson", "1584212893031-410e387fbaf1", text{"Red motor cruiser through white water", "Kapal motor merah membelah ombak"}},

	{"phinisi-red-sails", "1650445363412-275a423da839", text{"Phinisi with red sails near Komodo hills", "Phinisi berlayar merah dekat perbukitan Komodo"}},
	{"phinisi-raja-ampat", "1653404786584-2166b81a5b3c", text{"Wooden phinisi in a green island channel", "Phinisi kayu di selat pulau hijau"}},
	{"phinisi-bay", "1729673767003-f6852682fc10", text{"Wooden boats anchored in a Komodo bay", "Kapal kayu berlabuh di teluk Komodo"}},
	{"phinisi-silhouette", "1665234811705-02e42eda85d2", text{"Phinisi silhouette against a pink sky", "Siluet phinisi dengan langit merah muda"}},
	{"phinisi-white", "1720059737088-4c8a1c040ee2", text{"White wooden liveaboard at sea", "Kapal kayu liveaboard putih di laut"}},
	{"phinisi-wood", "1557292915-f2a849da8337", text{"Traditional wooden boat by a rocky shore", "Kapal kayu tradisional di pantai berbatu"}},

	{"place-padar", "1619880889144-d6e252999afa", text{"Padar Island viewpoint over three bays", "Titik pandang Pulau Padar di atas tiga teluk"}},
	{"place-komodo", "1670773109200-0903d98cb0a6", text{"Green hill rising from a Komodo strait", "Bukit hijau di selat Komodo"}},
	{"place-pink-beach", "1643044034131-001b53336bd0", text{"Pink sand beach in Komodo National Park", "Pantai pasir merah muda di Taman Nasional Komodo"}},
	{"place-padar-dusk", "1589309736404-2e142a2acdf0", text{"Padar Island bays at sunset", "Teluk Pulau Padar saat matahari terbenam"}},
	{"place-wayag", "1703769605297-cc74106244d9", text{"Limestone islets of Raja Ampat", "Pulau karst di Raja Ampat"}},
	{"place-piaynemo", "1702664045144-8c97b3034d26", text{"Aerial view of Raja Ampat lagoons", "Pemandangan udara laguna Raja Ampat"}},
	{"place-misool", "1650445332429-75ceee3f3226", text{"Island maze in clear blue water", "Gugusan pulau di air biru jernih"}},
	{"place-diamond", "1577717903315-1691ae25ab3f", text{"Diamond Beach below Nusa Penida cliffs", "Pantai Diamond di bawah tebing Nusa Penida"}},
	{"place-kelingking", "1541666282672-5f4aad922c63", text{"Kelingking cliff and beach on Nusa Penida", "Tebing dan pantai Kelingking di Nusa Penida"}},
	{"place-gili", "1587364125669-354c5735dd2d", text{"Aerial view of a Gili island", "Pemandangan udara pulau Gili"}},
	{"place-gili-reef", "1619681216575-d6b3964fc278", text{"Gili island ringed by coral reef", "Pulau Gili dikelilingi terumbu karang"}},
	{"place-lombok-beach", "1694637173869-72c51857c6e9", text{"White beach facing Lombok mountains", "Pantai putih menghadap pegunungan Lombok"}},
	{"place-turtle", "1709483095301-2d1f3e95b1d4", text{"Green sea turtle over a coral reef", "Penyu hijau di atas terumbu karang"}},

	{"interior-saloon", "1697124510322-27ef594f67fd", text{"Bright yacht saloon with cream sofas", "Salon yacht terang dengan sofa krem"}},
	{"interior-cabin", "1697207340462-c9eac5047014", text{"Guest cabin with a wide sea view", "Kabin tamu dengan pemandangan laut lebar"}},
	{"interior-lounge", "1535078035266-a0fa7d3b8f65", text{"Lounge with sculpted backlit panels", "Lounge dengan panel berlampu"}},
	{"interior-dining", "1600812703042-38e573598898", text{"Formal dining table on a superyacht", "Meja makan formal di superyacht"}},
	{"moment-couple", "1775717621320-cde667fb8489", text{"Couple embracing on deck at sunset", "Pasangan berpelukan di dek saat matahari terbenam"}},
}

type keyed struct {
	key  string
	name text
}

var demoCategories = []keyed{
	{"motor-yacht", text{"Motor Yacht", "Motor Yacht"}},
	{"catamaran", text{"Catamaran", "Katamaran"}},
	{"phinisi", text{"Phinisi", "Phinisi"}},
	{"speedboat", text{"Speedboat", "Speedboat"}},
	{"sailing-yacht", text{"Sailing Yacht", "Yacht Layar"}},
}

var demoClasses = []keyed{
	{"vvip", text{"VVIP", "VVIP"}},
	{"vip", text{"VIP", "VIP"}},
	{"premium", text{"Premium", "Premium"}},
	{"deluxe", text{"Deluxe", "Deluxe"}},
}

var demoFacilities = []keyed{
	{"air-conditioning", text{"Air conditioning", "AC"}},
	{"wifi", text{"Onboard Wi-Fi", "Wi-Fi di kapal"}},
	{"sound-system", text{"Sound system", "Sistem audio"}},
	{"shower", text{"Freshwater shower", "Shower air tawar"}},
	{"snorkeling", text{"Snorkeling gear", "Peralatan snorkeling"}},
	{"paddleboard", text{"Paddle boards", "Paddle board"}},
	{"kitchen", text{"Galley kitchen", "Dapur kapal"}},
	{"bbq", text{"Deck barbecue", "Barbekyu di dek"}},
	{"sundeck", text{"Sun deck", "Sun deck"}},
	{"life-jackets", text{"Life jackets", "Jaket pelampung"}},
	{"cabins", text{"Air-conditioned cabins", "Kabin ber-AC"}},
	{"jet-ski", text{"Jet ski on request", "Jet ski atas permintaan"}},
}

var demoPartners = []struct{ key, name, contact, email, phone string }{
	{"bahari", "PT Bahari Jaya (Demo)", "Made Wirawan", "bahari@partner.example", "+62 361 555 0101"},
	{"nusa", "CV Nusa Marine (Demo)", "Lalu Hidayat", "nusa@partner.example", "+62 370 555 0102"},
	{"flores", "Flores Sail Co (Demo)", "Yohanes Bili", "flores@partner.example", "+62 385 555 0103"},
}

var demoRegions = []struct {
	slug, name  string
	description text
	photos      []string
}{
	{"bali", "Bali", text{"Leave Benoa for Nusa Penida's cliffs, Lembongan's mangroves and sunset cruises along the Bukit coast.",
		"Berangkat dari Benoa menuju tebing Nusa Penida, mangrove Lembongan, dan pesiar senja di pesisir Bukit."}, []string{"place-diamond", "place-kelingking"}},
	{"lombok", "Lombok", text{"Calm crossings to the three Gilis and the quiet islands of the southwest coast.",
		"Penyeberangan tenang ke tiga Gili dan pulau-pulau sepi di pesisir barat daya."}, []string{"place-gili", "place-gili-reef", "place-lombok-beach"}},
	{"labuan-bajo", "Labuan Bajo", text{"Gateway to Komodo National Park: dragon islands, pink sand and manta channels.",
		"Pintu masuk Taman Nasional Komodo: pulau komodo, pasir merah muda, dan selat manta."}, []string{"place-padar", "place-komodo", "place-pink-beach", "place-padar-dusk"}},
	{"raja-ampat", "Raja Ampat", text{"Multi-day voyages through limestone lagoons from Sorong.",
		"Pelayaran beberapa hari menyusuri laguna karst dari Sorong."}, []string{"place-wayag", "place-piaynemo", "place-misool"}},
}

type demoPort struct {
	key, region, name, address, timezone string
	lat, lng                             float64
}

var demoPorts = []demoPort{
	{"benoa", "bali", "Benoa Harbour", "Jl. Pelabuhan Benoa, Denpasar", "Asia/Makassar", -8.7446, 115.2126},
	{"teluk-nare", "lombok", "Teluk Nare", "Teluk Nare, Lombok Utara", "Asia/Makassar", -8.4397, 116.0417},
	{"labuan-bajo", "labuan-bajo", "Labuan Bajo Marina", "Jl. Soekarno-Hatta, Labuan Bajo", "Asia/Makassar", -8.4969, 119.8866},
	{"sorong", "raja-ampat", "Sorong Harbour", "Pelabuhan Sorong, Papua Barat Daya", "Asia/Jayapura", -0.8833, 131.25},
}

func portOf(key string) demoPort {
	for _, p := range demoPorts {
		if p.key == key {
			return p
		}
	}
	panic("unknown demo port " + key)
}

type demoStop struct {
	name     string
	lat, lng float64
	activity text
}

var demoRoutes = []struct {
	slug, region, port string
	minutes            int
	name, description  text
	photo              string
	stops              []demoStop
}{
	{"benoa-sunset-cruise", "bali", "benoa", 180, text{"Benoa Sunset Cruise", "Pesiar Senja Benoa"}, text{"A short evening cruise past Uluwatu's cliffs and back to Benoa.", "Pesiar sore singkat melewati tebing Uluwatu lalu kembali ke Benoa."}, "yacht-sunset", []demoStop{
		{"Jimbaran Bay", -8.7708, 115.1531, text{"Cruise along the bay", "Menyusuri teluk"}},
		{"Uluwatu Cliffs", -8.8291, 115.0849, text{"Sunset from the water", "Menikmati senja dari laut"}},
	}},
	{"nusa-penida-day-trip", "bali", "benoa", 480, text{"Nusa Penida Day Trip", "Perjalanan Sehari Nusa Penida"}, text{"Snorkel Crystal Bay and anchor beneath the cliffs of Nusa Penida.", "Snorkeling di Crystal Bay dan berlabuh di bawah tebing Nusa Penida."}, "place-kelingking", []demoStop{
		{"Crystal Bay", -8.7133, 115.4606, text{"Snorkeling and lunch", "Snorkeling dan makan siang"}},
		{"Manta Bay", -8.7928, 115.5236, text{"Manta watching", "Melihat manta"}},
	}},
	{"nusa-lembongan-escape", "bali", "benoa", 360, text{"Nusa Lembongan Escape", "Pelesir Nusa Lembongan"}, text{"Mangroves and shallow reefs off Nusa Lembongan.", "Mangrove dan karang dangkal di lepas Nusa Lembongan."}, "place-diamond", []demoStop{
		{"Mangrove Point", -8.6614, 115.4544, text{"Reef snorkeling", "Snorkeling karang"}},
		{"Dream Beach", -8.6972, 115.4381, text{"Beach stop", "Singgah di pantai"}},
	}},
	{"three-gilis-loop", "lombok", "teluk-nare", 360, text{"Three Gilis Loop", "Keliling Tiga Gili"}, text{"Trawangan, Meno and Air in one calm day.", "Trawangan, Meno, dan Air dalam satu hari yang tenang."}, "place-gili", []demoStop{
		{"Gili Trawangan", -8.3501, 116.0386, text{"Turtle snorkeling", "Snorkeling bersama penyu"}},
		{"Gili Meno", -8.3506, 116.0564, text{"Beach and lunch", "Pantai dan makan siang"}},
		{"Gili Air", -8.3581, 116.0815, text{"Swim stop", "Berenang"}},
	}},
	{"secret-gilis-southwest", "lombok", "teluk-nare", 540, text{"Secret Gilis Southwest", "Gili Tersembunyi Barat Daya"}, text{"Quiet sandbars of the Sekotong peninsula.", "Gosong pasir sepi di semenanjung Sekotong."}, "place-lombok-beach", []demoStop{
		{"Gili Nanggu", -8.7178, 115.9972, text{"Snorkeling", "Snorkeling"}},
		{"Gili Kedis", -8.7211, 115.9856, text{"Sandbar picnic", "Piknik di gosong pasir"}},
	}},
	{"komodo-highlights", "labuan-bajo", "labuan-bajo", 600, text{"Komodo Highlights", "Sorotan Komodo"}, text{"Padar's viewpoint, Pink Beach and a ranger walk with the dragons.", "Puncak Padar, Pantai Pink, dan berjalan bersama ranger melihat komodo."}, "place-padar", []demoStop{
		{"Padar Island", -8.6500, 119.5833, text{"Sunrise hike", "Mendaki saat matahari terbit"}},
		{"Pink Beach", -8.6028, 119.5167, text{"Snorkeling", "Snorkeling"}},
		{"Komodo Island", -8.5500, 119.4833, text{"Ranger walk", "Berjalan bersama ranger"}},
	}},
	{"kelor-rinca-day-sail", "labuan-bajo", "labuan-bajo", 480, text{"Kelor and Rinca Day Sail", "Berlayar Sehari Kelor dan Rinca"}, text{"A shorter day: a Kelor hilltop and dragons on Rinca.", "Hari yang lebih singkat: bukit Kelor dan komodo di Rinca."}, "place-komodo", []demoStop{
		{"Kelor Island", -8.4611, 119.8181, text{"Short hike and swim", "Mendaki singkat dan berenang"}},
		{"Rinca Island", -8.6500, 119.7000, text{"Ranger walk", "Berjalan bersama ranger"}},
	}},
	{"raja-ampat-voyage", "raja-ampat", "sorong", 4320, text{"Raja Ampat Three-Day Voyage", "Pelayaran Tiga Hari Raja Ampat"}, text{"Three days through Dampier Strait and the Piaynemo lagoons.", "Tiga hari menyusuri Selat Dampier dan laguna Piaynemo."}, "place-wayag", []demoStop{
		{"Dampier Strait", -0.5500, 130.6500, text{"Reef diving and snorkeling", "Menyelam dan snorkeling karang"}},
		{"Piaynemo", -0.5667, 130.2667, text{"Viewpoint climb", "Mendaki titik pandang"}},
		{"Arborek", -0.5642, 130.5236, text{"Village visit", "Mengunjungi desa"}},
	}},
}

type demoBoat struct {
	name, category, class, port, partner string
	pax, lengthCm, beamCm, year          int
	cabins, baths, knots, crew           int
	hourly, daily, fixed                 int64
	photos                               []string
}

// Prices are illustrative IDR amounts chosen to make listings and filters look realistic.
var demoBoats = []demoBoat{
	{"Ocean Majesty", "motor-yacht", "vvip", "benoa", "", 24, 3800, 800, 2019, 5, 5, 22, 8, 18_500_000, 165_000_000, 0, []string{"yacht-hills", "yacht-super"}},
	{"Azure Serenity", "motor-yacht", "vip", "benoa", "", 16, 2600, 640, 2017, 4, 4, 24, 5, 9_500_000, 82_000_000, 0, []string{"yacht-flybridge", "yacht-aerial"}},
	{"Golden Horizon", "motor-yacht", "vvip", "benoa", "bahari", 20, 3200, 720, 2020, 5, 5, 20, 7, 14_000_000, 125_000_000, 0, []string{"yacht-harbor", "yacht-dusk"}},
	{"Sunset Voyager", "motor-yacht", "premium", "benoa", "", 12, 1800, 500, 2016, 2, 2, 26, 3, 5_500_000, 46_000_000, 0, []string{"yacht-sunset", "yacht-wake"}},
	{"Blue Lagoon One", "catamaran", "premium", "benoa", "", 30, 2000, 900, 2018, 3, 3, 14, 4, 0, 38_000_000, 24_000_000, []string{"catamaran-turquoise", "catamaran-sunset"}},
	{"Island Breeze", "catamaran", "deluxe", "benoa", "bahari", 40, 2200, 1000, 2015, 0, 2, 12, 5, 0, 32_000_000, 19_500_000, []string{"catamaran-island", "catamaran-deck"}},
	{"Penida Express", "speedboat", "deluxe", "benoa", "", 14, 1100, 300, 2021, 0, 1, 35, 2, 2_200_000, 0, 8_500_000, []string{"speed-wake", "speed-islands"}},
	{"Coral Dash", "speedboat", "deluxe", "benoa", "", 10, 900, 280, 2022, 0, 0, 38, 2, 1_650_000, 0, 6_500_000, []string{"speed-green", "speed-wake"}},
	{"Lembongan Runner", "speedboat", "premium", "benoa", "bahari", 12, 1200, 320, 2020, 0, 1, 34, 2, 2_750_000, 0, 9_500_000, []string{"speed-cruiser", "speed-bow"}},
	{"Bukit Sport", "speedboat", "vip", "benoa", "", 8, 1400, 360, 2023, 1, 1, 42, 2, 4_800_000, 0, 15_000_000, []string{"speed-bronze", "speed-turn"}},
	{"Gili Spirit", "motor-yacht", "vip", "teluk-nare", "nusa", 14, 2400, 600, 2018, 3, 3, 24, 4, 8_250_000, 72_000_000, 0, []string{"yacht-turquoise", "yacht-top"}},
	{"Rinjani Star", "motor-yacht", "premium", "teluk-nare", "", 10, 1650, 470, 2015, 2, 2, 28, 3, 4_750_000, 39_000_000, 0, []string{"yacht-island", "yacht-sport"}},
	{"Sekotong Pearl", "catamaran", "premium", "teluk-nare", "nusa", 24, 1800, 860, 2019, 2, 2, 13, 3, 0, 29_000_000, 17_500_000, []string{"catamaran-bay", "catamaran-deck"}},
	{"Trawangan Flyer", "speedboat", "deluxe", "teluk-nare", "", 12, 1050, 300, 2021, 0, 1, 36, 2, 1_900_000, 0, 7_250_000, []string{"speed-islands", "speed-green"}},
	{"Meno Sprint", "speedboat", "deluxe", "teluk-nare", "nusa", 8, 850, 270, 2022, 0, 0, 40, 1, 1_350_000, 0, 5_250_000, []string{"speed-turn", "speed-sunset"}},
	{"Tanjung Sail", "sailing-yacht", "premium", "teluk-nare", "", 8, 1500, 430, 2014, 3, 2, 9, 3, 0, 27_500_000, 16_000_000, []string{"sail-sunset", "sail-blue"}},
	{"Komodo Dream", "phinisi", "vvip", "labuan-bajo", "", 16, 4200, 900, 2019, 7, 7, 10, 12, 0, 148_000_000, 0, []string{"phinisi-red-sails", "place-padar-dusk"}},
	{"Sea Dragon", "phinisi", "vip", "labuan-bajo", "flores", 14, 3600, 820, 2018, 6, 6, 9, 9, 0, 105_000_000, 0, []string{"phinisi-bay", "place-pink-beach"}},
	{"Padar Explorer", "phinisi", "premium", "labuan-bajo", "", 18, 3000, 750, 2016, 5, 5, 9, 7, 0, 68_000_000, 0, []string{"phinisi-silhouette", "place-padar"}},
	{"Flores Wind", "phinisi", "deluxe", "labuan-bajo", "flores", 20, 2800, 700, 2014, 4, 3, 8, 6, 0, 46_000_000, 0, []string{"phinisi-white", "place-komodo"}},
	{"Lumba Lumba", "phinisi", "deluxe", "labuan-bajo", "", 12, 2200, 620, 2012, 3, 2, 8, 5, 0, 34_000_000, 0, []string{"phinisi-wood", "place-komodo"}},
	{"Pink Beach Cruiser", "motor-yacht", "premium", "labuan-bajo", "", 10, 1700, 480, 2017, 2, 2, 25, 3, 6_250_000, 52_000_000, 0, []string{"yacht-sport-2", "place-pink-beach"}},
	{"Kelor Swift", "speedboat", "deluxe", "labuan-bajo", "", 10, 1000, 290, 2021, 0, 1, 36, 2, 2_500_000, 0, 9_000_000, []string{"speed-sunset", "speed-islands"}},
	{"Manta Runner", "speedboat", "premium", "labuan-bajo", "flores", 12, 1250, 330, 2022, 0, 1, 38, 2, 3_250_000, 0, 11_500_000, []string{"speed-crimson", "speed-bow"}},
	{"Rinca Sailor", "sailing-yacht", "vip", "labuan-bajo", "", 10, 1900, 500, 2016, 4, 3, 10, 4, 0, 58_000_000, 34_000_000, []string{"sail-schooner", "sail-lagoon"}},
	{"Raja Laut", "phinisi", "vvip", "sorong", "", 20, 4600, 950, 2021, 8, 8, 10, 14, 0, 195_000_000, 0, []string{"phinisi-raja-ampat", "place-wayag"}},
	{"Wayag Spirit", "phinisi", "vip", "sorong", "", 16, 3800, 840, 2017, 6, 6, 9, 10, 0, 118_000_000, 0, []string{"phinisi-bay", "place-piaynemo"}},
	{"Misool Pearl", "motor-yacht", "vip", "sorong", "", 12, 2300, 580, 2019, 3, 3, 23, 5, 0, 96_000_000, 0, []string{"yacht-forest", "place-misool"}},
	{"Dampier Cat", "catamaran", "premium", "sorong", "", 18, 1900, 880, 2020, 4, 4, 13, 5, 0, 74_000_000, 0, []string{"catamaran-white", "catamaran-sail"}},
	{"Piaynemo Sail", "sailing-yacht", "premium", "sorong", "", 10, 1700, 470, 2015, 4, 3, 9, 4, 0, 64_000_000, 0, []string{"sail-lagoon", "place-piaynemo"}},
}

func slugOf(name string) string { return media.Slugify(name) }

func (b demoBoat) overnight() bool { return b.cabins > 0 && b.daily > 0 }

type demoRate struct {
	unit               string
	price              int64
	minUnits, maxUnits int
}

func (b demoBoat) rates() []demoRate {
	var out []demoRate
	if b.hourly > 0 {
		out = append(out, demoRate{"HOURLY", b.hourly, 3, 14})
	}
	if b.daily > 0 {
		maxDays := 1
		if b.overnight() {
			maxDays = 7
		}
		out = append(out, demoRate{"DAILY", b.daily, 1, maxDays})
	}
	if b.fixed > 0 {
		out = append(out, demoRate{"FIXED", b.fixed, 1, 1})
	}
	return out
}

type demoArea struct {
	deck           string
	name           text
	description    text
	minPax, maxPax int
	price          int64
	photo          string
}

// Boats that take 14 or more guests sell their decks separately on departures; smaller boats are
// only ever sold whole.
func (b demoBoat) soldAreas() []demoArea {
	if b.pax < 14 || b.category == "speedboat" {
		return nil
	}
	base := max(b.daily, b.fixed) / 4
	top := b.pax / 4
	middle := (b.pax - top) / 2
	return []demoArea{
		{"Upper Deck", text{"Sky Lounge", "Sky Lounge"}, text{"Open-air lounge with the best view on board.", "Lounge terbuka dengan pemandangan terbaik di kapal."}, 2, top, base, "deck-lounge"},
		{"Main Deck", text{"Main Saloon", "Salon Utama"}, text{"Shaded saloon opening onto the aft deck.", "Salon teduh yang terbuka ke dek belakang."}, 1, middle, base / 2, "interior-saloon"},
		{"Lower Deck", text{"Guest Cabins", "Kabin Tamu"}, text{"Air-conditioned cabins for resting between stops.", "Kabin ber-AC untuk beristirahat di antara persinggahan."}, 1, b.pax - top - middle, base / 2, "interior-cabin"},
	}
}

func facilitiesFor(b demoBoat) []string {
	out := []string{"life-jackets", "snorkeling"}
	if b.category != "speedboat" {
		out = append(out, "shower", "sundeck", "sound-system", "air-conditioning")
	}
	if b.cabins > 0 {
		out = append(out, "cabins", "kitchen")
	}
	if b.category == "catamaran" || b.category == "phinisi" {
		out = append(out, "paddleboard", "bbq")
	}
	if b.class == "vvip" || b.class == "vip" {
		out = append(out, "wifi", "jet-ski")
	}
	return out
}

func interiorsFor(b demoBoat) []string {
	switch b.category {
	case "speedboat":
		return nil
	case "phinisi", "sailing-yacht":
		return []string{"interior-cabin", "deck-sunbed"}
	case "catamaran":
		return []string{"interior-saloon", "deck-sunbed"}
	}
	if b.class == "vvip" {
		return []string{"interior-dining", "interior-lounge", "deck-lounge"}
	}
	return []string{"interior-saloon", "interior-cabin", "deck-lounge"}
}

var boatCopy = map[string]text{
	"motor-yacht":   {"Motor yacht for %d guests with air-conditioned lounges and a crew of %d.", "Motor yacht untuk %d tamu dengan lounge ber-AC dan %d awak."},
	"catamaran":     {"Stable twin-hull catamaran for %d guests with wide decks and a crew of %d.", "Katamaran lambung ganda yang stabil untuk %d tamu dengan dek lebar dan %d awak."},
	"phinisi":       {"Hand-built wooden phinisi for %d guests, sailed by a crew of %d.", "Phinisi kayu buatan tangan untuk %d tamu, dilayarkan oleh %d awak."},
	"speedboat":     {"Fast speedboat for %d guests, driven by a crew of %d.", "Speedboat cepat untuk %d tamu, dikemudikan oleh %d awak."},
	"sailing-yacht": {"Classic sailing yacht for %d guests with a crew of %d.", "Yacht layar klasik untuk %d tamu dengan %d awak."},
}

func (b demoBoat) copy(locale string) (summary, description string) {
	summary = fmt.Sprintf(boatCopy[b.category].get(locale), b.pax, b.crew)
	meters := float64(b.lengthCm) / 100
	if locale == "id" {
		return summary, fmt.Sprintf("%s adalah kapal sepanjang %.0f meter buatan %d yang berpangkalan di %s. %s Deskripsi ini adalah data demo.", b.name, meters, b.year, portOf(b.port).name, summary)
	}
	return summary, fmt.Sprintf("%s is a %.0f metre boat built in %d and based at %s. %s This description is demo data.", b.name, meters, b.year, portOf(b.port).name, summary)
}
