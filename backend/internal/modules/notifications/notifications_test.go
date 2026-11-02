package notifications

import (
	"strings"
	"testing"
)

func TestMessagePlainText(t *testing.T) {
	cases := []struct {
		name string
		v    view
		want string
	}{
		{
			name: "rows and action stay unescaped",
			v: view{Greeting: "Hello O'Brien & co,", Body: "Trip <confirmed>.", Signoff: "Thanks,\nGoYacht",
				Rows:      []row{{"Boat", "Ocean Majesty"}, {"Paid", "IDR 1.000"}},
				ActionURL: "https://example.com/b?a=1&c=2", ActionLabel: "View booking"},
			want: "Hello O'Brien & co,\n\nTrip <confirmed>.\n\nBoat: Ocean Majesty\nPaid: IDR 1.000\n\nView booking: https://example.com/b?a=1&c=2\n\nThanks,\nGoYacht\n",
		},
		{
			name: "no rows and no action",
			v:    view{Greeting: "Hello,", Body: "Welcome.", Signoff: "Thanks"},
			want: "Hello,\n\nWelcome.\n\n\nThanks\n",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			msg, err := c.v.message()
			if err != nil {
				t.Fatal(err)
			}
			if msg.Text != c.want {
				t.Fatalf("text body\n got %q\nwant %q", msg.Text, c.want)
			}
		})
	}
}

func TestMessageHTMLEscapesBookingData(t *testing.T) {
	v := view{Subject: "Booking", Greeting: "Hello <script>alert(1)</script>,", Rows: []row{{"Boat", "<b>Ocean</b>"}}}
	msg, err := v.message()
	if err != nil {
		t.Fatal(err)
	}
	if msg.Subject != "Booking" {
		t.Fatalf("subject = %q", msg.Subject)
	}
	for _, raw := range []string{"<script>", "<b>Ocean"} {
		if strings.Contains(msg.HTML, raw) {
			t.Fatalf("unescaped %q in HTML body", raw)
		}
	}
	for _, escaped := range []string{"&lt;script&gt;", "&lt;b&gt;Ocean"} {
		if !strings.Contains(msg.HTML, escaped) {
			t.Fatalf("missing %q in HTML body", escaped)
		}
	}
}
