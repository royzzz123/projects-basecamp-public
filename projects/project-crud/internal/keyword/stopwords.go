package keyword

// stopWords is a combined English + SEBI-domain stop list.
// English function words are omitted so TF scoring surfaces meaningful terms.
// Domain entries kill words that appear in nearly every complaint regardless
// of what the complaint is actually about.
var stopWords = func() map[string]struct{} {
	words := []string{
		// English function words
		"the", "and", "for", "that", "this", "with", "from", "have", "been",
		"they", "were", "will", "your", "which", "their", "there", "would",
		"about", "when", "what", "also", "than", "then", "into", "more",
		"some", "such", "other", "after", "before", "upon", "over", "under",
		"these", "those", "shall", "should", "could", "might", "must", "been",
		"being", "does", "doing", "done", "said", "here", "where", "while",
		"very", "just", "even", "only", "not", "but", "has", "had", "was",
		"are", "our", "out", "all", "any", "may", "him", "her", "his", "its",
		"who", "can", "did", "get", "got", "its", "now", "how", "too", "yet",
		"per", "via", "due",
		// Complaint filing boilerplate
		"complaint", "complaints", "complain", "complaining",
		"sebi", "investor", "investors",
		"dear", "sir", "madam", "respected",
		"please", "kindly", "request", "requesting", "requested",
		"thank", "thanks", "thanking", "regards", "sincerely",
		"above", "below", "mentioned", "enclosed", "attached", "herewith",
		"hereby", "therefore", "hence", "thus", "accordingly",
		"subject", "reference", "regarding", "concerning", "matter",
		"inform", "informed", "informing", "information",
		"write", "writing", "written", "letter",
		"submitted", "submitting", "submit",
		"seek", "seeking", "sought",
		"like", "need", "want", "wish",
		// Generic time/quantity words
		"date", "month", "months", "year", "years", "day", "days",
		"week", "weeks", "time", "times", "period",
		"first", "second", "third", "last", "next", "previous", "recent",
		"number", "numbers", "amount", "amounts",
		// Common filler
		"said", "same", "both", "each", "many", "much", "more", "most",
		"one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
	}
	m := make(map[string]struct{}, len(words))
	for _, w := range words {
		m[w] = struct{}{}
	}
	return m
}()
