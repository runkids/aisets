package config

import "testing"

func TestMatchesOCRSearchValueRejectsUnrelatedShortLogoWords(t *testing.T) {
	for _, text := range []string{
		"MAYAN EMPIRE",
		"Mahjong for 2 Players",
		"FortuneTREE",
		"FourCard Suit",
	} {
		if matchesOCRSearchValue(text, "FIRE") {
			t.Fatalf("matchesOCRSearchValue(%q, FIRE) = true", text)
		}
	}
}
