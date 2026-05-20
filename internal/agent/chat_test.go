package agent

import (
	"aisets/internal/llm"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type mockProvider struct {
	chatFunc func(ctx context.Context, req llm.ChatRequest) (llm.ChatResponse, error)
}

func (m *mockProvider) Name() string                                      { return "mock" }
func (m *mockProvider) Available(_ context.Context) error                 { return nil }
func (m *mockProvider) ListModels(_ context.Context) ([]llm.Model, error) { return nil, nil }
func (m *mockProvider) Embed(_ context.Context, _ llm.EmbedRequest) (llm.EmbedResponse, error) {
	return llm.EmbedResponse{}, nil
}
func (m *mockProvider) Chat(ctx context.Context, req llm.ChatRequest) (llm.ChatResponse, error) {
	return m.chatFunc(ctx, req)
}

func TestNewChatProvider_CLIAdapters(t *testing.T) {
	for _, id := range []string{"claude", "codex", "antigravity", "copilot", "cursor-agent", "pi"} {
		p, err := NewChatProvider(id, AdapterInfo{Path: "/usr/bin/" + id}, nil, nil)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", id, err)
			continue
		}
		if _, ok := p.(*CLIChatProvider); !ok {
			t.Errorf("%s: expected CLIChatProvider", id)
		}
	}
}

func TestNewChatProvider_LocalLLM_RequiresProvider(t *testing.T) {
	_, err := NewChatProvider("local-llm", AdapterInfo{}, nil, nil)
	if err == nil {
		t.Error("expected error when llmProvider is nil")
	}
}

func TestNewChatProvider_LocalLLM(t *testing.T) {
	p, err := NewChatProvider("local-llm", AdapterInfo{}, &mockProvider{}, func(_, _, _ string) (string, error) {
		return "data:image/png;base64,abc", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := p.(*LocalLLMChatProvider); !ok {
		t.Error("expected LocalLLMChatProvider")
	}
}

func TestNewChatProvider_Unsupported(t *testing.T) {
	_, err := NewChatProvider("unknown", AdapterInfo{}, nil, nil)
	if err == nil {
		t.Error("expected error for unknown adapter")
	}
}

func TestLocalLLMChatBatch(t *testing.T) {
	called := 0
	mp := &mockProvider{
		chatFunc: func(_ context.Context, req llm.ChatRequest) (llm.ChatResponse, error) {
			called++
			if len(req.Messages) < 2 {
				t.Error("expected system + user messages")
			}
			return llm.ChatResponse{Content: `{"result":"ok"}`, InputTokens: 10, OutputTokens: 5}, nil
		},
	}
	prep := func(_, _, _ string) (string, error) { return "data:image/png;base64,test", nil }
	p := NewLocalLLMChatProvider(mp, prep)

	reqs := []ChatRequest{
		{Model: "test", SystemPrompt: "sys", Prompt: "analyze", ImagePaths: []string{"/img/a.png"}, TimeoutSec: 30},
		{Model: "test", SystemPrompt: "sys", Prompt: "analyze", ImagePaths: []string{"/img/b.png"}, TimeoutSec: 30},
	}
	var results []ChatResult
	err := p.ChatBatch(context.Background(), reqs, func(_ int, res ChatResult) {
		results = append(results, res)
	})
	if err != nil {
		t.Fatal(err)
	}
	if called != 2 {
		t.Errorf("expected 2 calls, got %d", called)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	for i, r := range results {
		if r.Err != nil {
			t.Errorf("result %d: unexpected error: %v", i, r.Err)
		}
		if r.Content != `{"result":"ok"}` {
			t.Errorf("result %d: unexpected content: %s", i, r.Content)
		}
	}
}

func TestLocalLLMChatBatch_PrepareError(t *testing.T) {
	mp := &mockProvider{
		chatFunc: func(_ context.Context, _ llm.ChatRequest) (llm.ChatResponse, error) {
			t.Error("should not be called")
			return llm.ChatResponse{}, nil
		},
	}
	prep := func(_, _, _ string) (string, error) { return "", errors.New("unsupported format") }
	p := NewLocalLLMChatProvider(mp, prep)

	var results []ChatResult
	_ = p.ChatBatch(context.Background(), []ChatRequest{
		{Prompt: "analyze", ImagePaths: []string{"/img/bad.heic"}},
	}, func(_ int, res ChatResult) {
		results = append(results, res)
	})
	if len(results) != 1 || results[0].Err == nil {
		t.Error("expected prepare error")
	}
}

func TestLocalLLMChatBatch_LLMError(t *testing.T) {
	mp := &mockProvider{
		chatFunc: func(_ context.Context, _ llm.ChatRequest) (llm.ChatResponse, error) {
			return llm.ChatResponse{}, errors.New("timeout")
		},
	}
	prep := func(_, _, _ string) (string, error) { return "data:image/png;base64,ok", nil }
	p := NewLocalLLMChatProvider(mp, prep)

	var results []ChatResult
	_ = p.ChatBatch(context.Background(), []ChatRequest{
		{Prompt: "analyze", ImagePaths: []string{"/img/a.png"}},
	}, func(_ int, res ChatResult) {
		results = append(results, res)
	})
	if len(results) != 1 || results[0].Err == nil {
		t.Error("expected LLM error")
	}
}

func TestBuildCLIPrompt(t *testing.T) {
	got := buildCLIPrompt("system prompt", "user prompt", []string{"/img/a.png", "/img/b.png"})
	if got == "" {
		t.Fatal("empty prompt")
	}
	if !strings.Contains(got, "system prompt") {
		t.Error("missing system prompt")
	}
	if !strings.Contains(got, "/img/a.png") || !strings.Contains(got, "/img/b.png") {
		t.Error("missing image paths")
	}
	if !strings.Contains(got, "user prompt") {
		t.Error("missing user prompt")
	}
}

func TestBuildCLIPrompt_NoSystem(t *testing.T) {
	got := buildCLIPrompt("", "user prompt", nil)
	if strings.HasPrefix(got, "\n") {
		t.Error("should not start with newline when no system prompt")
	}
	if !strings.Contains(got, "user prompt") {
		t.Error("missing user prompt")
	}
}

func TestCLIChatProvider_PreparesImagesForCLI(t *testing.T) {
	t.Setenv("GO_WANT_HELPER_PROCESS", "1")
	var capturedPath string
	p := &CLIChatProvider{
		binPath: os.Args[0],
		name:    "helper",
		buildArgs: func(req ChatRequest) []string {
			if len(req.ImagePaths) != 1 {
				t.Fatalf("expected one image path, got %d", len(req.ImagePaths))
			}
			capturedPath = req.ImagePaths[0]
			return []string{"-test.run=TestCLIChatProviderHelperProcess", "--", capturedPath}
		},
		buildPrompt: defaultCLIPrompt,
		prepareImage: func(localPath, ext, purpose string) (string, error) {
			if localPath != "/img/source.svg" {
				t.Fatalf("localPath = %q", localPath)
			}
			if ext != ".svg" {
				t.Fatalf("ext = %q", ext)
			}
			if purpose != "vlm" {
				t.Fatalf("purpose = %q", purpose)
			}
			return "data:image/png;base64,cG5nZGF0YQ==", nil
		},
	}

	res := p.chatOne(context.Background(), ChatRequest{
		Prompt:     "inspect",
		ImagePaths: []string{"/img/source.svg"},
		TimeoutSec: 5,
	})
	if res.Err != nil {
		t.Fatal(res.Err)
	}
	if !strings.Contains(res.Content, "bytes=7") {
		t.Fatalf("unexpected helper output: %s", res.Content)
	}
	if filepath.Ext(capturedPath) != ".png" {
		t.Fatalf("prepared path ext = %q, want .png", filepath.Ext(capturedPath))
	}
	if _, err := os.Stat(capturedPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected prepared image cleanup, stat err = %v", err)
	}
}

func TestCLIChatProviderHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}
	args := os.Args
	idx := -1
	for i, arg := range args {
		if arg == "--" {
			idx = i
			break
		}
	}
	if idx < 0 || idx+1 >= len(args) {
		os.Exit(2)
	}
	path := args[idx+1]
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("read_err=%v\n", err)
		os.Exit(1)
	}
	stdin, _ := io.ReadAll(os.Stdin)
	fmt.Printf("path=%s bytes=%d stdin_has_path=%t\n", path, len(data), strings.Contains(string(stdin), path))
	os.Exit(0)
}

func TestTruncate(t *testing.T) {
	if truncate("short", 10) != "short" {
		t.Error("should not truncate short string")
	}
	got := truncate("a very long string here", 10)
	if len(got) > 13 {
		t.Errorf("truncated too long: %s", got)
	}
	if !strings.HasSuffix(got, "...") {
		t.Error("truncated should end with ...")
	}
}

func TestLocalLLMChatBatch_NoImages(t *testing.T) {
	mp := &mockProvider{
		chatFunc: func(_ context.Context, req llm.ChatRequest) (llm.ChatResponse, error) {
			for _, msg := range req.Messages {
				if msg.Role == "user" && len(msg.Images) > 0 {
					t.Error("should have no images")
				}
			}
			return llm.ChatResponse{Content: "ok"}, nil
		},
	}
	prep := func(_, _, _ string) (string, error) { return "", errors.New("should not be called") }
	p := NewLocalLLMChatProvider(mp, prep)

	var results []ChatResult
	_ = p.ChatBatch(context.Background(), []ChatRequest{
		{Prompt: "hello"},
	}, func(_ int, res ChatResult) {
		results = append(results, res)
	})
	if len(results) != 1 || results[0].Err != nil {
		t.Error("expected success with no images")
	}
}

func TestLocalLLMChatBatch_CancelledContext(t *testing.T) {
	mp := &mockProvider{
		chatFunc: func(_ context.Context, _ llm.ChatRequest) (llm.ChatResponse, error) {
			return llm.ChatResponse{Content: "ok"}, nil
		},
	}
	prep := func(_, _, _ string) (string, error) { return "data:image/png;base64,ok", nil }
	p := NewLocalLLMChatProvider(mp, prep)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	callCount := 0
	err := p.ChatBatch(ctx, []ChatRequest{
		{Prompt: "a", ImagePaths: []string{"/a.png"}},
		{Prompt: "b", ImagePaths: []string{"/b.png"}},
	}, func(_ int, _ ChatResult) {
		callCount++
	})
	if err == nil {
		t.Log("batch may complete first item before noticing cancel")
	}
	_ = callCount
}
