package payments

import "testing"

func TestIsDashboardTest(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"dashboard test", `{"order_id":"payment_notif_test_M331907185_37997746-3ed5-427c-a879-584816bf0a0a","status_code":"200","gross_amount":"105000.00","transaction_status":"settlement"}`, true},
		{"real order", `{"order_id":"GY-HPXETVNNY6BH-5H2J8D","status_code":"200","transaction_status":"settlement"}`, false},
		{"prefix not at start", `{"order_id":"GY-payment_notif_test_x"}`, false},
		{"missing order_id", `{"status_code":"200"}`, false},
		{"malformed", `{"order_id":`, false},
	}
	for _, c := range cases {
		if got := isDashboardTest([]byte(c.body)); got != c.want {
			t.Errorf("%s: isDashboardTest = %v, want %v", c.name, got, c.want)
		}
	}
}
