package agent

import "context"

type Adapter interface {
	ID() string
	Detect(ctx context.Context) (*AdapterInfo, error)
}

type AdapterInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
}

type RuntimeStatus struct {
	Adapters  []AdapterInfo `json:"adapters"`
	Active    string        `json:"active"`
	Available bool          `json:"available"`
}
