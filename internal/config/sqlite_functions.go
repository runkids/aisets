package config

import (
	"database/sql/driver"
	"math"
	"regexp"
	"strings"
	"unicode"

	"modernc.org/sqlite"
)

func init() {
	sqlite.MustRegisterDeterministicScalarFunction("asset_folder", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 1 {
			return "", nil
		}
		value, _ := args[0].(string)
		index := strings.LastIndex(value, "/")
		if index <= 0 {
			return "", nil
		}
		return value[:index], nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("asset_name", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 1 {
			return "", nil
		}
		value, _ := args[0].(string)
		index := strings.LastIndex(value, "/")
		if index < 0 || index == len(value)-1 {
			return value, nil
		}
		return value[index+1:], nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("regexp_like", 2, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 2 {
			return int64(0), nil
		}
		value, _ := args[0].(string)
		pattern, _ := args[1].(string)
		matched, err := regexp.MatchString(pattern, value)
		if err != nil || !matched {
			return int64(0), nil
		}
		return int64(1), nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("ocr_search_match", 2, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) != 2 {
			return int64(0), nil
		}
		if matchesOCRSearchValue(sqliteString(args[0]), sqliteString(args[1])) {
			return int64(1), nil
		}
		return int64(0), nil
	})
}

func sqliteString(value driver.Value) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return ""
	}
}

func matchesOCRSearchValue(text, query string) bool {
	normalizedText := strings.ToLower(strings.TrimSpace(text))
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	if normalizedText == "" || normalizedQuery == "" {
		return false
	}
	if strings.Contains(normalizedText, normalizedQuery) {
		return true
	}
	queryRunes := []rune(normalizedQuery)
	if len(queryRunes) < 4 {
		return false
	}
	maxDistance := 2
	if len(queryRunes) <= 4 {
		maxDistance = 1
	}
	for _, token := range ocrSearchTokens(normalizedText) {
		tokenRunes := []rune(token)
		if len(tokenRunes) < 3 || int(math.Abs(float64(len(tokenRunes)-len(queryRunes)))) > 2 {
			continue
		}
		if strings.HasPrefix(normalizedQuery, token) || strings.HasPrefix(token, normalizedQuery) {
			return true
		}
		if len(queryRunes) <= 4 && tokenRunes[0] != queryRunes[0] {
			continue
		}
		if matchesOCRSearchWindow(tokenRunes, queryRunes, maxDistance) {
			return true
		}
		if boundedOCRSearchEditDistance(tokenRunes, queryRunes, maxDistance) <= maxDistance {
			return true
		}
	}
	return false
}

func ocrSearchTokens(text string) []string {
	tokens := []string{}
	current := strings.Builder{}
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			current.WriteRune(r)
			continue
		}
		if current.Len() > 0 {
			tokens = append(tokens, current.String())
			current.Reset()
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

func matchesOCRSearchWindow(token, query []rune, maxDistance int) bool {
	if len(token) <= len(query) {
		return false
	}
	for _, size := range []int{len(query) - 1, len(query), len(query) + 1} {
		if size < 3 || size > len(token) {
			continue
		}
		for start := 0; start <= len(token)-size; start++ {
			window := token[start : start+size]
			if len(query) <= 4 && window[0] != query[0] {
				continue
			}
			if boundedOCRSearchEditDistance(window, query, maxDistance) <= maxDistance {
				return true
			}
		}
	}
	return false
}

func boundedOCRSearchEditDistance(a, b []rune, maxDistance int) int {
	previous := make([]int, len(b)+1)
	for index := range previous {
		previous[index] = index
	}
	for i := 1; i <= len(a); i++ {
		current := make([]int, len(b)+1)
		current[0] = i
		rowMin := current[0]
		for j := 1; j <= len(b); j++ {
			cost := 0
			if a[i-1] != b[j-1] {
				cost = 1
			}
			value := min(previous[j]+1, current[j-1]+1, previous[j-1]+cost)
			current[j] = value
			rowMin = min(rowMin, value)
		}
		if rowMin > maxDistance {
			return maxDistance + 1
		}
		previous = current
	}
	return previous[len(b)]
}
