package version

import "fmt"

const repo = "runkids/asset-studio"

func BuildUIDistURL(ver string) string {
	return fmt.Sprintf("https://github.com/%s/releases/download/v%s/asset-studio-ui-dist.tar.gz", repo, ver)
}

func BuildChecksumsURL(ver string) string {
	return fmt.Sprintf("https://github.com/%s/releases/download/v%s/checksums.txt", repo, ver)
}
