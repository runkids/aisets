package lint

import "testing"

func TestMissingLazyLoading(t *testing.T) {
	tests := []struct {
		name    string
		ctx     Context
		wantNil bool
	}{
		{
			name:    "no img tag",
			ctx:     Context{Content: `import logo from './logo.png'`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "has loading attr",
			ctx:     Context{Content: `<img src="x.png" loading="lazy" />`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "has fetchpriority",
			ctx:     Context{Content: `<img src="x.png" fetchpriority="high" />`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "svg ignored",
			ctx:     Context{Content: `<img src="icon.svg" />`, AssetBytes: 50_000, AssetExt: ".svg"},
			wantNil: true,
		},
		{
			name:    "small file ignored",
			ctx:     Context{Content: `<img src="small.png" />`, AssetBytes: 15_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "triggers",
			ctx:     Context{Content: `<img src="hero.png" />`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MissingLazyLoading(tt.ctx)
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
			if got != nil && got.RuleID != "missing-lazy-loading" {
				t.Errorf("ruleID = %q", got.RuleID)
			}
		})
	}
}

func TestMissingDimensions(t *testing.T) {
	tests := []struct {
		name    string
		content string
		wantNil bool
	}{
		{"no img", `import x from './x.png'`, true},
		{"has width+height", `<img src="x.png" width="100" height="50" />`, true},
		{"has tailwind w+h", `<img src="x.png" class="w-20 h-20" />`, true},
		{"has tailwind w+aspect", `<img src="x.png" class="w-20 aspect-square" />`, true},
		{"missing height", `<img src="x.png" width="100" />`, false},
		{"missing both", `<img src="x.png" />`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MissingDimensions(Context{Content: tt.content, AssetBytes: 1000, AssetExt: ".png"})
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
		})
	}
}

func TestLargeInlineImport(t *testing.T) {
	tests := []struct {
		name    string
		ctx     Context
		wantNil bool
	}{
		{
			name:    "small file",
			ctx:     Context{Content: `import icon from './icon.svg?raw'`, Specifier: "./icon.svg?raw", AssetBytes: 5_000, AssetExt: ".svg"},
			wantNil: true,
		},
		{
			name:    "no import keyword",
			ctx:     Context{Content: `const x = require('./big.png?raw')`, Specifier: "./big.png?raw", AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "no raw/inline query",
			ctx:     Context{Content: `import img from './big.png'`, Specifier: "./big.png", AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "css-url kind excluded",
			ctx:     Context{Content: `import x from './bg.png?inline'`, Specifier: "./bg.png?inline", Kind: "css-url", AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "triggers",
			ctx:     Context{Content: `import svg from './large.svg?raw'`, Specifier: "./large.svg?raw", Kind: "string", AssetBytes: 50_000, AssetExt: ".svg"},
			wantNil: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := LargeInlineImport(tt.ctx)
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
		})
	}
}

func TestNoResponsiveImage(t *testing.T) {
	tests := []struct {
		name    string
		ctx     Context
		wantNil bool
	}{
		{
			name:    "small file",
			ctx:     Context{Content: `<img src="x.png" />`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "svg ignored",
			ctx:     Context{Content: `<img src="x.svg" />`, AssetBytes: 200_000, AssetExt: ".svg"},
			wantNil: true,
		},
		{
			name:    "has srcset",
			ctx:     Context{Content: `<img src="x.png" srcset="x-2x.png 2x" />`, AssetBytes: 200_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "small fixed width",
			ctx:     Context{Content: `<img src="icon.png" width="48" />`, AssetBytes: 200_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "triggers",
			ctx:     Context{Content: `<img src="hero.png" />`, AssetBytes: 200_000, AssetExt: ".png"},
			wantNil: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NoResponsiveImage(tt.ctx)
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
		})
	}
}

func TestSvgAsImg(t *testing.T) {
	tests := []struct {
		name    string
		ctx     Context
		wantNil bool
	}{
		{
			name:    "not svg",
			ctx:     Context{Content: `<img src="photo.png" />`, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "svg but no img tag",
			ctx:     Context{Content: `import icon from './icon.svg'`, AssetExt: ".svg"},
			wantNil: true,
		},
		{
			name:    "triggers",
			ctx:     Context{Content: `<img src="logo.svg" />`, AssetExt: ".svg"},
			wantNil: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SvgAsImg(tt.ctx)
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
		})
	}
}

func TestImgAsBackground(t *testing.T) {
	tests := []struct {
		name    string
		ctx     Context
		wantNil bool
	}{
		{
			name:    "no img tag",
			ctx:     Context{Content: `background: url(bg.png)`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "small file",
			ctx:     Context{Content: `<img src="x.png" alt="" />`, AssetBytes: 10_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "non-empty alt",
			ctx:     Context{Content: `<img src="x.png" alt="photo" />`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "triggers",
			ctx:     Context{Content: `<img src="decor.png" alt="" />`, AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ImgAsBackground(tt.ctx)
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
		})
	}
}

func TestBgContentImage(t *testing.T) {
	tests := []struct {
		name    string
		ctx     Context
		wantNil bool
	}{
		{
			name:    "not css-url kind",
			ctx:     Context{Content: `import bg from './bg.png'`, Kind: "string", AssetBytes: 200_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "small file",
			ctx:     Context{Content: `url(bg.png)`, Kind: "css-url", AssetBytes: 50_000, AssetExt: ".png"},
			wantNil: true,
		},
		{
			name:    "svg excluded",
			ctx:     Context{Content: `url(bg.svg)`, Kind: "css-url", AssetBytes: 200_000, AssetExt: ".svg"},
			wantNil: true,
		},
		{
			name:    "triggers",
			ctx:     Context{Content: `url(hero.png)`, Kind: "css-url", AssetBytes: 200_000, AssetExt: ".png"},
			wantNil: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BgContentImage(tt.ctx)
			if tt.wantNil && got != nil {
				t.Errorf("expected nil, got %+v", got)
			}
			if !tt.wantNil && got == nil {
				t.Error("expected finding, got nil")
			}
		})
	}
}

func TestRunReturnsMultipleFindings(t *testing.T) {
	ctx := Context{
		Content:    `<img src="hero.png" alt="" />`,
		Kind:       "string",
		AssetBytes: 200_000,
		AssetExt:   ".png",
		AssetID:    "test-1",
		File:       "src/App.tsx",
		Line:       10,
	}
	findings := Run(ctx)
	if len(findings) == 0 {
		t.Fatal("expected at least one finding")
	}
	ruleIDs := map[string]bool{}
	for _, f := range findings {
		ruleIDs[f.RuleID] = true
		if f.File != "src/App.tsx" {
			t.Errorf("file = %q, want src/App.tsx", f.File)
		}
		if f.AssetID != "test-1" {
			t.Errorf("assetID = %q, want test-1", f.AssetID)
		}
	}
	if !ruleIDs["missing-lazy-loading"] {
		t.Error("expected missing-lazy-loading finding")
	}
	if !ruleIDs["missing-dimensions"] {
		t.Error("expected missing-dimensions finding")
	}
}
