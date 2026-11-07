package keyword

import (
	"sort"
	"strings"
	"unicode"
)

// minWordLen is the minimum character length for a word to appear in a bigram.
// 3 catches meaningful short terms like "fee", "tax", "act" that would be
// dropped at 4 but are useful inside a phrase like "high fee" or "exit load".
const minWordLen = 3

// TopKeywords returns the top n most characteristic two-word phrases (bigrams)
// across texts, each paired with the number of complaints it appeared in.
//
// Scoring uses document frequency — how many texts contain the bigram — rather
// than raw occurrence count. This de-weights boilerplate phrases that appear in
// every complaint while surfacing the specific language investors actually use
// to describe their problem ("account freeze", "unauthorized trade", etc.).
//
// Bigrams are formed from adjacent non-stopword tokens; both words must be at
// least minWordLen characters. Each bigram is counted at most once per document.
func TopKeywords(texts []string, n int) []Keyword {
	docFreq := make(map[string]int, 256)

	for _, text := range texts {
		tokens := tokenize(text)
		seen := make(map[string]struct{}, len(tokens))

		for i := 0; i+1 < len(tokens); i++ {
			w1, w2 := tokens[i], tokens[i+1]
			if len(w1) < minWordLen || len(w2) < minWordLen {
				continue
			}
			if _, skip := stopWords[w1]; skip {
				continue
			}
			if _, skip := stopWords[w2]; skip {
				continue
			}
			bigram := w1 + " " + w2
			if _, already := seen[bigram]; !already {
				docFreq[bigram]++
				seen[bigram] = struct{}{}
			}
		}
	}

	type kv struct {
		phrase string
		freq   int
	}
	ranked := make([]kv, 0, len(docFreq))
	for p, f := range docFreq {
		ranked = append(ranked, kv{p, f})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].freq != ranked[j].freq {
			return ranked[i].freq > ranked[j].freq
		}
		return ranked[i].phrase < ranked[j].phrase
	})

	if n > len(ranked) {
		n = len(ranked)
	}
	out := make([]Keyword, n)
	for i := range n {
		out[i] = Keyword{Word: ranked[i].phrase, Count: ranked[i].freq}
	}
	return out
}

// tokenize lowercases text and splits on any non-letter rune.
func tokenize(text string) []string {
	text = strings.ToLower(text)
	tokens := make([]string, 0, 64)
	var cur strings.Builder
	for _, r := range text {
		if unicode.IsLetter(r) {
			cur.WriteRune(r)
		} else if cur.Len() > 0 {
			tokens = append(tokens, cur.String())
			cur.Reset()
		}
	}
	if cur.Len() > 0 {
		tokens = append(tokens, cur.String())
	}
	return tokens
}
