package server

import (
	"net/http"
	"sort"

	"aisets/internal/aliasdetect"
)

type detectedAlias struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type detectedAliasProject struct {
	ProjectID   string          `json:"projectId"`
	ProjectName string          `json:"projectName"`
	Aliases     []detectedAlias `json:"aliases"`
}

// handleDetectedAliases reports the import aliases auto-detected from each
// active-workspace project's tsconfig/jsconfig and vite/next config. It is
// read-only: the frontend pairs it with the manual importAliases override
// table so users can see what resolution already covers. Projects with no
// detected aliases are omitted.
func (s *Server) handleDetectedAliases(w http.ResponseWriter, _ *http.Request) {
	projects := s.store.Projects()
	out := make([]detectedAliasProject, 0, len(projects))
	for _, p := range projects {
		detected := aliasdetect.Detect(p.Path)
		if len(detected) == 0 {
			continue
		}
		aliases := make([]detectedAlias, 0, len(detected))
		for key, value := range detected {
			aliases = append(aliases, detectedAlias{Key: key, Value: value})
		}
		sort.Slice(aliases, func(i, j int) bool { return aliases[i].Key < aliases[j].Key })
		out = append(out, detectedAliasProject{
			ProjectID:   p.ID,
			ProjectName: p.Name,
			Aliases:     aliases,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ProjectName < out[j].ProjectName })
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}
