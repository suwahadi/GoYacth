package seed

import (
	"fmt"

	"github.com/google/uuid"
)

// firstExtraGuest follows the eight guests of demoReviews.
const firstExtraGuest = 9

// Invented guests and reviews, for the development database only: see demoReviews.
var demoGuests = []struct{ name, country, locale string }{
	{"Olivia Bennett", "GB", "en"}, {"Lucas Meyer", "DE", "en"}, {"Dewi Lestari", "ID", "id"},
	{"Chloe Martin", "FR", "en"}, {"Hiroshi Tanaka", "JP", "en"}, {"Bagus Wirawan", "ID", "id"},
	{"Mia Johansson", "SE", "en"}, {"Ethan Walker", "US", "en"}, {"Putri Anggraini", "ID", "id"},
	{"Isabella Rossi", "IT", "en"}, {"Noah Visser", "NL", "en"}, {"Andi Saputra", "ID", "id"},
	{"Grace Lim", "SG", "en"}, {"William Hughes", "AU", "en"}, {"Nadia Hasanah", "ID", "id"},
	{"Sofia Garcia", "ES", "en"}, {"Liam Murphy", "IE", "en"}, {"Rizky Pratama", "ID", "id"},
	{"Hannah Schmidt", "AT", "en"}, {"Thomas Dubois", "BE", "en"}, {"Made Suastika", "ID", "id"},
	{"Emma Nielsen", "DK", "en"}, {"Jack Wilson", "NZ", "en"}, {"Siti Rahmawati", "ID", "id"},
	{"Aisha Rahman", "MY", "en"}, {"Minjun Kim", "KR", "en"}, {"Yoga Permana", "ID", "id"},
	{"Priya Sharma", "IN", "en"}, {"Anna Kowalska", "PL", "en"}, {"Citra Maharani", "ID", "id"},
}

type reviewLine struct{ title, body text }

// Lines follow the boat type, so a speedboat review never talks about cabins.
var demoReviewLines = map[string][]reviewLine{
	"motor-yacht": {
		{text{"Like a private hotel at sea", "Seperti hotel pribadi di laut"}, text{"Cabins were cool and spotless, and the saloon stayed comfortable even at midday.", "Kabin sejuk dan bersih, salonnya tetap nyaman meski tengah hari."}},
		{text{"Smooth from start to finish", "Lancar dari awal sampai akhir"}, text{"The captain picked a calm line between the islands and nobody in our group felt seasick.", "Kapten memilih jalur tenang di antara pulau dan tidak ada yang mabuk laut."}},
		{text{"Sunset on the top deck", "Senja di dek atas"}, text{"We spent the last hour on the sun deck with drinks while the crew took care of everything below.", "Satu jam terakhir kami habiskan di sun deck sambil menikmati minuman, awak kapal mengurus semuanya."}},
		{text{"Perfect for our anniversary", "Pas untuk ulang tahun pernikahan"}, text{"The table was set on deck when we came back from swimming, and every request we sent in advance was remembered.", "Meja sudah tertata di dek saat kami selesai berenang, dan semua permintaan kami sebelumnya diingat."}},
		{text{"Three generations on board", "Tiga generasi dalam satu kapal"}, text{"My parents stayed in the shade of the aft deck while the kids jumped off the swim platform.", "Orang tua saya bersantai di dek belakang yang teduh, anak-anak melompat dari platform renang."}},
		{text{"A chef who listens", "Koki yang mau mendengarkan"}, text{"He asked about allergies before we boarded, and lunch was fish caught that morning.", "Ia menanyakan alergi sebelum kami naik, dan makan siangnya ikan tangkapan pagi itu."}},
	},
	"catamaran": {
		{text{"Room for everyone", "Lega untuk semua"}, text{"There were twenty of us on board and it never felt crowded. The front nets were the favourite spot.", "Kami berdua puluh orang dan tidak pernah terasa sesak. Jaring depan jadi tempat favorit."}},
		{text{"Steady all day", "Stabil sepanjang hari"}, text{"The two hulls kept everything stable, so even the kids could walk around safely while we were moving.", "Dua lambungnya membuat kapal stabil, anak-anak pun aman berjalan saat kapal melaju."}},
		{text{"Ideal for a company outing", "Cocok untuk acara kantor"}, text{"Our team had plenty of shade, a good sound system and an easy swim stop at lunch.", "Tim kami dapat banyak tempat teduh, audio yang bagus, dan berenang santai saat makan siang."}},
		{text{"Barbecue on the water", "Barbekyu di atas air"}, text{"The crew grilled fresh fish on the back deck while we paddled around the bay.", "Awak kapal memanggang ikan segar di dek belakang sementara kami mendayung di teluk."}},
		{text{"Easy snorkeling stops", "Snorkeling yang mudah"}, text{"The ladder made it simple to get in and out of the water, and the guides stayed close to the beginners.", "Tangganya memudahkan naik turun air, dan pemandu selalu dekat dengan yang masih pemula."}},
		{text{"A relaxed day out", "Hari yang santai"}, text{"No rush at any stop. We stayed longer at the beach because everyone was having a good time.", "Tidak terburu-buru di setiap perhentian. Kami lebih lama di pantai karena semua menikmatinya."}},
	},
	"speedboat": {
		{text{"Quick and well organised", "Cepat dan tertata"}, text{"Picked up on time and at the first reef in under an hour. The crew handled our bags.", "Dijemput tepat waktu dan tiba di karang pertama kurang dari satu jam. Tas kami diurus awak kapal."}},
		{text{"Fun ride, careful crew", "Seru, tapi tetap hati-hati"}, text{"Fast across the open water, then slow and careful near the reef. Life jackets were handed out before we left.", "Cepat di laut lepas, lalu pelan dan hati-hati dekat karang. Jaket pelampung dibagikan sebelum berangkat."}},
		{text{"More islands in one day", "Lebih banyak pulau dalam sehari"}, text{"We fitted three stops into a single day, which a slower boat could not have managed.", "Kami singgah di tiga tempat dalam sehari, tidak akan sempat dengan kapal yang lebih lambat."}},
		{text{"Great for a small group", "Pas untuk rombongan kecil"}, text{"Just the six of us, and the skipper took us where the big boats cannot go.", "Hanya kami berenam, dan kapten membawa kami ke tempat yang tidak terjangkau kapal besar."}},
		{text{"Clean boat, good skipper", "Kapal bersih, kapten andal"}, text{"Seats were dry and clean, and the skipper knew the currents in the strait well.", "Kursinya kering dan bersih, kapten paham betul arus di selat."}},
		{text{"An easy escape", "Pelarian singkat yang mudah"}, text{"We left after breakfast and were back for dinner, with plenty of swimming in between.", "Berangkat setelah sarapan dan kembali sebelum makan malam, dengan banyak waktu berenang."}},
	},
	"sail": {
		{text{"Sailing the old way", "Berlayar seperti dulu"}, text{"Watching the crew raise the sails at sunrise was the highlight of our trip.", "Melihat awak kapal menaikkan layar saat matahari terbit jadi momen terbaik perjalanan kami."}},
		{text{"Nights under the stars", "Malam di bawah bintang"}, text{"We slept on deck one night and the crew brought coffee up before sunrise.", "Satu malam kami tidur di dek, dan awak kapal membawakan kopi sebelum matahari terbit."}},
		{text{"Guides who know the islands", "Pemandu yang paham pulau-pulaunya"}, text{"He took us to reefs that were empty when we arrived.", "Ia membawa kami ke karang yang masih sepi saat kami tiba."}},
		{text{"A beautiful wooden boat", "Kapal kayu yang cantik"}, text{"The woodwork has been kept in lovely condition, and the cabins were cosy and clean.", "Kayunya terawat sangat baik, kabinnya hangat dan bersih."}},
		{text{"Slow travel at its best", "Perjalanan santai yang sesungguhnya"}, text{"No engine noise for most of the crossing, just the wind and the water.", "Hampir sepanjang penyeberangan tanpa suara mesin, hanya angin dan air."}},
		{text{"Food beyond expectations", "Makanannya di luar dugaan"}, text{"Three fresh meals a day from a tiny galley. We are still talking about the grilled fish.", "Tiga kali makan segar dari dapur mungil. Kami masih membicarakan ikan bakarnya."}},
	},
}

// A three-star review reads as one, instead of praise under a low score.
var demoMixedLines = []reviewLine{
	{text{"Good trip, late start", "Perjalanan baik, berangkatnya telat"}, text{"We left almost an hour late and lost time at the first stop. The crew made up for it afterwards.", "Kami berangkat hampir satu jam terlambat dan kehilangan waktu di perhentian pertama. Awak kapal menebusnya setelah itu."}},
	{text{"Nice boat, choppy day", "Kapal bagus, ombak besar"}, text{"The sea was rough in the afternoon and the crossing was uncomfortable, though the crew kept us informed.", "Laut bergelombang sore itu dan penyeberangan kurang nyaman, meski awak kapal terus memberi kabar."}},
	{text{"Lovely, but lunch was basic", "Menyenangkan, tapi makan siangnya biasa"}, text{"The boat and the crew were good. Lunch was simpler than we expected for the price.", "Kapal dan awaknya bagus. Makan siangnya lebih sederhana dari perkiraan kami untuk harga ini."}},
	{text{"Decent, could be better", "Cukup baik, masih bisa lebih"}, text{"The day went fine overall, but shade on deck was limited around midday.", "Secara umum baik, tetapi tempat teduh di dek terbatas saat tengah hari."}},
}

var demoClosers = []text{
	{"We would book again without a second thought.", "Kami pasti memesan lagi."},
	{"Booking was simple and the team answered quickly on WhatsApp.", "Pemesanannya mudah dan timnya cepat membalas di WhatsApp."},
	{"The crew learned our names on the first morning.", "Awak kapal sudah hafal nama kami sejak pagi pertama."},
	{"We are already planning the next trip.", "Kami sudah merencanakan perjalanan berikutnya."},
	{"Recommended for anyone visiting Indonesia.", "Direkomendasikan untuk siapa pun yang berlibur di Indonesia."},
	{"Everything matched the photos.", "Semuanya sesuai dengan foto."},
	{"Pickup and timing were exactly as promised.", "Penjemputan dan waktunya tepat seperti yang dijanjikan."},
	{"Thank you to the whole crew.", "Terima kasih untuk seluruh awak kapal."},
}

// Scores include fours and the odd three, so boats do not all average 5.0.
var demoScores = []int{5, 5, 4, 5, 3, 5, 4, 5, 5, 4, 5, 5, 4}

func demoLineKind(category string) string {
	if category == "phinisi" || category == "sailing-yacht" {
		return "sail"
	}
	return category
}

func guestEmail(n int) string { return fmt.Sprintf("guest-%d@example.com", n) }

func (s *seeder) guest(n int, name, country, locale string) uuid.UUID {
	return s.insert(`INSERT INTO users (provider, provider_subject, email, full_name, nationality, preferred_locale) VALUES ('demo', $1, $2, $3, $4, $5) RETURNING id`,
		fmt.Sprintf("guest-%d", n), guestEmail(n), name, country, locale)
}

// guestReviews gives every boat three to six reviews. They are not featured, so the homepage keeps
// its eight.
func (s *seeder) guestReviews() {
	users := make([]uuid.UUID, len(demoGuests))
	for i, g := range demoGuests {
		users[i] = s.guest(firstExtraGuest+i, g.name, g.country, g.locale)
	}
	written := 0
	for b, boat := range demoBoats {
		routes := boat.routes()
		lines := demoReviewLines[demoLineKind(boat.category)]
		for j := range 3 + (b*2+1)%4 {
			n := written % len(demoGuests)
			guest := demoGuests[n]
			written++
			score := demoScores[(b*7+j*3)%len(demoScores)]
			line := lines[(b+j)%len(lines)]
			body := line.body.get(guest.locale) + " " + demoClosers[(b*3+j*5)%len(demoClosers)].get(guest.locale)
			if score < 4 {
				line = demoMixedLines[(b+j)%len(demoMixedLines)]
				body = line.body.get(guest.locale)
			}
			s.review(demoReview{
				name: guest.name, country: guest.country, locale: guest.locale,
				boat: boat.name, route: routes[j%len(routes)],
				pax: 2 + (b+j*3)%(boat.pax-1), daysAgo: 20 + (b*11+j*37)%380,
				overall: score, boatScore: min(5, score+(b+j)%2), service: min(5, score+(b+j+1)%2), crew: min(5, score+j%2),
				title: line.title.get(guest.locale), body: body,
			}, users[n], guestEmail(firstExtraGuest+n), false)
		}
	}
}

// addGuestReviews brings a database seeded before the review set grew up to date, without
// downloading the photos again.
func (s *seeder) addGuestReviews() bool {
	var done bool
	s.err = s.tx.QueryRow(s.ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE provider = 'demo' AND provider_subject = $1)`, fmt.Sprintf("guest-%d", firstExtraGuest)).Scan(&done)
	if s.err != nil || done {
		return false
	}
	s.boats, s.routes = map[string]seededBoat{}, map[string]uuid.UUID{}
	for sql, put := range map[string]func(string, uuid.UUID){
		`SELECT t.name, b.id FROM boats b JOIN boat_translations t ON t.boat_id = b.id AND t.locale = 'en' WHERE b.code LIKE 'DEMO-%'`: func(k string, id uuid.UUID) { s.boats[k] = seededBoat{id: id} },
		`SELECT slug, route_id FROM route_translations WHERE locale = 'en'`:                                                            func(k string, id uuid.UUID) { s.routes[k] = id },
	} {
		rows, err := s.tx.Query(s.ctx, sql)
		if err != nil {
			s.err = err
			return false
		}
		for rows.Next() {
			var key string
			var id uuid.UUID
			if s.err = rows.Scan(&key, &id); s.err != nil {
				rows.Close()
				return false
			}
			put(key, id)
		}
		rows.Close()
		if s.err = rows.Err(); s.err != nil {
			return false
		}
	}
	s.guestReviews()
	return s.err == nil
}
