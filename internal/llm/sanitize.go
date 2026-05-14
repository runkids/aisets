package llm

import (
	"encoding/json"
	"regexp"
	"strings"
)

var localeNames = map[string]string{
	"en":    "English",
	"zh-TW": "Traditional Chinese (繁體中文)",
	"zh-CN": "Simplified Chinese (简体中文)",
	"ja":    "Japanese (日本語)",
	"ko":    "Korean (한국어)",
}

var (
	trailingCommaRe = regexp.MustCompile(`,\s*([}\]])`)
	missingCommaRe  = regexp.MustCompile(`(["\d\]}\w])\s*\n\s*"`)
)

func StripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
	}
	if strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
	}
	return strings.TrimSpace(s)
}

func FixJSON(s string) string {
	fallbackStart := -1
	for i, c := range s {
		if c != '{' {
			continue
		}
		if fallbackStart < 0 {
			fallbackStart = i
		}
		candidate := cleanJSONCandidate(extractBalancedJSON(s[i:]))
		if json.Valid([]byte(candidate)) {
			return candidate
		}
	}
	if fallbackStart < 0 {
		return s
	}
	return cleanJSONCandidate(extractBalancedJSON(s[fallbackStart:]))
}

func cleanJSONCandidate(s string) string {
	s = trailingCommaRe.ReplaceAllString(s, "$1")
	s = missingCommaRe.ReplaceAllString(s, `$1,"`)
	return s
}

func extractBalancedJSON(s string) string {
	depth := 0
	inStr := false
	esc := false
	end := len(s)
	for i, c := range s {
		if esc {
			esc = false
			continue
		}
		if c == '\\' && inStr {
			esc = true
			continue
		}
		if c == '"' {
			inStr = !inStr
			continue
		}
		if inStr {
			continue
		}
		if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 {
				end = i + 1
				break
			}
		}
	}
	return s[:end]
}

func CleanJSON(s string) string {
	return FixJSON(StripFences(strings.TrimSpace(s)))
}

func LocaleDisplayName(lang string) string {
	if name, ok := localeNames[lang]; ok {
		return name
	}
	return ""
}

func SystemPrompt(enabled bool, prompt string) string {
	if enabled && prompt != "" {
		return prompt
	}
	return ""
}

func AppendLocaleInstruction(prompt string, autoLocale bool, lang, instruction string) string {
	if !autoLocale || lang == "" {
		return prompt
	}
	name := LocaleDisplayName(lang)
	if name == "" {
		return prompt
	}
	return prompt + "\n\nIMPORTANT: " + instruction + " " + name + "."
}
