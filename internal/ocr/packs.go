package ocr

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

const tessdataFast = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/"

var languagePacks = []struct {
	Language string
	URL      string
}{
	{Language: "eng", URL: tessdataFast + "eng.traineddata"},
	{Language: "chi_tra", URL: tessdataFast + "chi_tra.traineddata"},
	{Language: "chi_sim", URL: tessdataFast + "chi_sim.traineddata"},
	{Language: "jpn", URL: tessdataFast + "jpn.traineddata"},
	{Language: "kor", URL: tessdataFast + "kor.traineddata"},
	{Language: "fra", URL: tessdataFast + "fra.traineddata"},
	{Language: "deu", URL: tessdataFast + "deu.traineddata"},
	{Language: "spa", URL: tessdataFast + "spa.traineddata"},
	{Language: "por", URL: tessdataFast + "por.traineddata"},
	{Language: "ita", URL: tessdataFast + "ita.traineddata"},
	{Language: "nld", URL: tessdataFast + "nld.traineddata"},
	{Language: "rus", URL: tessdataFast + "rus.traineddata"},
	{Language: "ukr", URL: tessdataFast + "ukr.traineddata"},
	{Language: "ara", URL: tessdataFast + "ara.traineddata"},
	{Language: "hin", URL: tessdataFast + "hin.traineddata"},
	{Language: "tha", URL: tessdataFast + "tha.traineddata"},
	{Language: "vie", URL: tessdataFast + "vie.traineddata"},
	{Language: "ind", URL: tessdataFast + "ind.traineddata"},
	{Language: "msa", URL: tessdataFast + "msa.traineddata"},
}

func DataDir(root string) string {
	return filepath.Join(root, "ocr", "tessdata")
}

func PackPath(root, language string) string {
	return filepath.Join(DataDir(root), language+".traineddata")
}

func Runtime(ctx context.Context, root string, engine Engine) RuntimeStatus {
	packs := make([]LanguagePack, 0, len(languagePacks))
	installed := false
	for _, pack := range languagePacks {
		path := PackPath(root, pack.Language)
		stat, err := os.Stat(path)
		item := LanguagePack{Language: pack.Language}
		if err == nil && stat.Size() > 0 {
			item.Installed = true
			item.SizeBytes = stat.Size()
			item.Path = path
			installed = true
		}
		packs = append(packs, item)
	}
	status := RuntimeStatus{
		AvailableLanguages: packs,
		Installed:          installed,
		DataDir:            DataDir(root),
		EngineName:         engine.Name(),
		EngineVersion:      engine.Version(),
		EngineAvailable:    true,
	}
	if checker, ok := engine.(AvailabilityChecker); ok {
		if err := checker.Available(ctx); err != nil {
			status.EngineAvailable = false
			status.EngineError = err.Error()
		}
	}
	return status
}

func InstalledLanguages(root string, requested []string) []string {
	requested = NormalizeLanguages(requested)
	out := []string{}
	for _, language := range requested {
		stat, err := os.Stat(PackPath(root, language))
		if err == nil && stat.Size() > 0 {
			out = append(out, language)
		}
	}
	return out
}

func InstallLanguagePacks(ctx context.Context, root string, languages []string) ([]LanguagePack, error) {
	languages = NormalizeLanguages(languages)
	if len(languages) == 0 {
		return nil, fmt.Errorf("no supported OCR languages requested")
	}
	if err := os.MkdirAll(DataDir(root), 0o755); err != nil {
		return nil, err
	}
	installed := []LanguagePack{}
	for _, language := range languages {
		pack, ok := languagePack(language)
		if !ok {
			continue
		}
		path := PackPath(root, language)
		if stat, err := os.Stat(path); err == nil && stat.Size() > 0 {
			installed = append(installed, LanguagePack{Language: language, Installed: true, SizeBytes: stat.Size(), Path: path})
			continue
		}
		tmp := path + ".tmp"
		if err := download(ctx, pack.URL, tmp); err != nil {
			_ = os.Remove(tmp)
			return nil, err
		}
		if err := os.Rename(tmp, path); err != nil {
			_ = os.Remove(tmp)
			return nil, err
		}
		stat, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		installed = append(installed, LanguagePack{Language: language, Installed: true, SizeBytes: stat.Size(), Path: path})
	}
	return installed, nil
}

func RemoveLanguagePacks(root string, languages []string) ([]LanguagePack, error) {
	languages = NormalizeLanguages(languages)
	if len(languages) == 0 {
		for _, pack := range languagePacks {
			languages = append(languages, pack.Language)
		}
	}
	for _, language := range languages {
		if err := os.Remove(PackPath(root, language)); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	return Runtime(context.Background(), root, NewDefaultEngine(root)).AvailableLanguages, nil
}

func languagePack(language string) (struct {
	Language string
	URL      string
}, bool) {
	for _, pack := range languagePacks {
		if pack.Language == language {
			return pack, true
		}
	}
	return struct {
		Language string
		URL      string
	}{}, false
}

func download(ctx context.Context, url, target string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download failed: %s", resp.Status)
	}
	file, err := os.Create(target)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := io.Copy(file, resp.Body); err != nil {
		return err
	}
	return nil
}
